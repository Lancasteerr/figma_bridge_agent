import {
  BridgeFault,
  type DesignFontName,
  type DesignPlan,
  type DesignStyleResource,
  type DesignVariableCollectionResource,
} from '@figma-agent/protocol';

export const GENERATED_RESOURCE_PLUGIN_DATA_KEY = 'figma-agent-mcp:generated-resource';

interface PreparedStyle {
  definition: DesignStyleResource;
  finalName: string;
  existing?: BaseStyle;
}

interface PreparedCollection {
  definition: DesignVariableCollectionResource;
  finalName: string;
  existing?: VariableCollection;
  existingVariables: Map<string, Variable>;
}

export interface PreparedDesignResources {
  styles: PreparedStyle[];
  collections: PreparedCollection[];
  styleTypes: Map<string, StyleType>;
  variableTypes: Map<string, VariableResolvedDataType>;
  reusedStyles: Map<string, BaseStyle>;
  reusedVariables: Map<string, Variable>;
}

export interface AppliedDesignResources {
  styles: Map<string, BaseStyle>;
  variables: Map<string, Variable>;
  resourceMap: Record<string, string>;
  commit(): void;
  rollback(): void;
}

/** 验证资源名称、结构和计划内 ref；本阶段不创建任何 Figma 对象。 */
export async function prepareDesignResources(
  plan: DesignPlan,
  fonts: Map<string, DesignFontName>,
): Promise<PreparedDesignResources> {
  const [paint, text, effect, grid, collections, variables] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalGridStylesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
  ]);
  const allStyles: BaseStyle[] = [...paint, ...text, ...effect, ...grid];
  const refs = new Set<string>();
  const styles: PreparedStyle[] = [];
  const preparedCollections: PreparedCollection[] = [];
  const styleTypes = new Map<string, StyleType>();
  const variableTypes = new Map<string, VariableResolvedDataType>();
  const reusedStyles = new Map<string, BaseStyle>();
  const reusedVariables = new Map<string, Variable>();

  for (const resource of plan.resources) {
    assertNewRef(resource.ref, refs);
    if (resource.kind === 'VARIABLE_COLLECTION') {
      const finalName = resourceName(plan.proposal.name, resource.name);
      const sameName = collections.filter((item) => item.name === finalName);
      if (sameName.length > 1) conflict(finalName, 'More than one local collection has this name.');
      const existing = sameName[0];
      const existingVariables = new Map<string, Variable>();
      for (const variable of resource.variables) {
        assertNewRef(variable.ref, refs);
        variableTypes.set(variable.ref, variable.resolvedType);
      }
      if (existing) {
        const members = variables.filter((item) => item.variableCollectionId === existing.id);
        assertCollectionMatches(resource, existing, members, finalName);
        for (const definition of resource.variables) {
          const member = members.find((item) => item.name === definition.name)!;
          existingVariables.set(definition.ref, member);
          reusedVariables.set(definition.ref, member);
        }
      }
      preparedCollections.push({
        definition: resource,
        finalName,
        ...(existing ? { existing } : {}),
        existingVariables,
      });
      continue;
    }

    const finalName = resourceName(plan.proposal.name, resource.name);
    const expectedType = styleType(resource);
    styleTypes.set(resource.ref, expectedType);
    const sameName = allStyles.filter((item) => item.name === finalName);
    if (sameName.length > 1) conflict(finalName, 'More than one local style has this name.');
    const existing = sameName[0];
    if (existing) {
      if (existing.type !== expectedType)
        conflict(finalName, 'The existing style has another type.');
      if (!sameStructure(resourceShape(resource, fonts), existingStyleShape(existing))) {
        conflict(finalName, 'The existing style has different content.');
      }
      reusedStyles.set(resource.ref, existing);
    }
    styles.push({ definition: resource, finalName, ...(existing ? { existing } : {}) });
  }

  return {
    styles,
    collections: preparedCollections,
    styleTypes,
    variableTypes,
    reusedStyles,
    reusedVariables,
  };
}

/** 在单个写事务内创建缺失资源，并提供显式提交/回滚钩子。 */
export function applyDesignResources(
  prepared: PreparedDesignResources,
  fonts: Map<string, DesignFontName>,
  operationId: string,
): AppliedDesignResources {
  const styles = new Map(prepared.reusedStyles);
  const variables = new Map(prepared.reusedVariables);
  const resourceMap: Record<string, string> = {};
  const created: Array<BaseStyle | VariableCollection> = [];
  const marked: Array<BaseStyle | VariableCollection | Variable> = [];
  const marker = JSON.stringify({ version: 1, operationId, state: 'BUILDING' });

  try {
    for (const item of prepared.styles) {
      const style = item.existing ?? createStyle(item.definition, fonts);
      if (!item.existing) {
        style.name = item.finalName;
        style.setPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY, marker);
        created.push(style);
        marked.push(style);
      }
      styles.set(item.definition.ref, style);
      resourceMap[item.definition.ref] = style.id;
    }

    for (const item of prepared.collections) {
      if (item.existing) {
        resourceMap[item.definition.ref] = item.existing.id;
        for (const variable of item.definition.variables) {
          resourceMap[variable.ref] = item.existingVariables.get(variable.ref)!.id;
        }
        continue;
      }
      const collection = figma.variables.createVariableCollection(item.finalName);
      collection.renameMode(collection.defaultModeId, 'Default');
      collection.setPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY, marker);
      created.push(collection);
      marked.push(collection);
      resourceMap[item.definition.ref] = collection.id;
      for (const definition of item.definition.variables) {
        const variable = figma.variables.createVariable(
          definition.name,
          collection,
          definition.resolvedType,
        );
        variable.setValueForMode(collection.defaultModeId, definition.value);
        variable.setPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY, marker);
        marked.push(variable);
        variables.set(definition.ref, variable);
        resourceMap[definition.ref] = variable.id;
      }
    }
  } catch (error) {
    for (const item of created.reverse()) item.remove();
    throw error;
  }

  return {
    styles,
    variables,
    resourceMap,
    commit() {
      const committed = JSON.stringify({ version: 1, operationId, state: 'COMMITTED' });
      for (const item of marked) item.setPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY, committed);
    },
    rollback() {
      for (const item of [...created].reverse()) item.remove();
    },
  };
}

export function resourceName(proposalName: string, providedName: string): string {
  const clean = (value: string) => value.trim().replaceAll('/', '-');
  return `Agent/${clean(proposalName)}/${clean(providedName)}`;
}

function createStyle(
  definition: DesignStyleResource,
  fonts: Map<string, DesignFontName>,
): BaseStyle {
  if (definition.kind === 'PAINT_STYLE') {
    const style = figma.createPaintStyle();
    style.paints = definition.paints as Paint[];
    return style;
  }
  if (definition.kind === 'EFFECT_STYLE') {
    const style = figma.createEffectStyle();
    style.effects = definition.effects as Effect[];
    return style;
  }
  if (definition.kind === 'GRID_STYLE') {
    const style = figma.createGridStyle();
    style.layoutGrids = definition.layoutGrids as LayoutGrid[];
    return style;
  }
  const style = figma.createTextStyle();
  const font = fonts.get(`resource:${definition.ref}:font`);
  if (!font) throw invalid(`Resolved font for text style ${definition.ref} is unavailable.`);
  style.fontName = font.variationSettings
    ? { family: font.family, style: font.style, variationSettings: font.variationSettings }
    : { family: font.family, style: font.style };
  style.fontSize = definition.fontSize;
  style.lineHeight = definition.lineHeight;
  style.letterSpacing = definition.letterSpacing;
  style.paragraphSpacing = definition.paragraphSpacing;
  style.textCase = definition.textCase;
  style.textDecoration = definition.textDecoration;
  return style;
}

function resourceShape(resource: DesignStyleResource, fonts: Map<string, DesignFontName>): unknown {
  if (resource.kind === 'PAINT_STYLE') return { type: 'PAINT', paints: resource.paints };
  if (resource.kind === 'EFFECT_STYLE') return { type: 'EFFECT', effects: resource.effects };
  if (resource.kind === 'GRID_STYLE') return { type: 'GRID', layoutGrids: resource.layoutGrids };
  return {
    type: 'TEXT',
    fontName: fonts.get(`resource:${resource.ref}:font`),
    fontSize: resource.fontSize,
    lineHeight: resource.lineHeight,
    letterSpacing: resource.letterSpacing,
    paragraphSpacing: resource.paragraphSpacing,
    textCase: resource.textCase,
    textDecoration: resource.textDecoration,
  };
}

function existingStyleShape(style: BaseStyle): unknown {
  if (style.type === 'PAINT') return { type: 'PAINT', paints: style.paints };
  if (style.type === 'EFFECT') return { type: 'EFFECT', effects: style.effects };
  if (style.type === 'GRID') return { type: 'GRID', layoutGrids: style.layoutGrids };
  return {
    type: 'TEXT',
    fontName: style.fontName,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    paragraphSpacing: style.paragraphSpacing,
    textCase: style.textCase,
    textDecoration: style.textDecoration,
  };
}

function assertCollectionMatches(
  definition: DesignVariableCollectionResource,
  collection: VariableCollection,
  variables: Variable[],
  finalName: string,
): void {
  if (collection.modes.length !== 1 || collection.modes[0]?.name !== 'Default') {
    conflict(finalName, 'The existing collection is not a single Default-mode collection.');
  }
  if (variables.length !== definition.variables.length) {
    conflict(finalName, 'The existing collection has a different variable set.');
  }
  for (const expected of definition.variables) {
    const actual = variables.find((item) => item.name === expected.name);
    const modeId = collection.defaultModeId;
    if (
      !actual ||
      actual.resolvedType !== expected.resolvedType ||
      !sameStructure(actual.valuesByMode[modeId], expected.value)
    ) {
      conflict(finalName, `Variable ${expected.name} has different content.`);
    }
  }
}

function styleType(resource: DesignStyleResource): StyleType {
  if (resource.kind === 'PAINT_STYLE') return 'PAINT';
  if (resource.kind === 'TEXT_STYLE') return 'TEXT';
  if (resource.kind === 'EFFECT_STYLE') return 'EFFECT';
  return 'GRID';
}

function assertNewRef(ref: string, refs: Set<string>): void {
  if (refs.has(ref)) throw invalid(`Duplicate resource ref: ${ref}.`);
  refs.add(ref);
}

function sameStructure(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined && key !== 'boundVariables')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function conflict(name: string, reason: string): never {
  throw new BridgeFault({
    code: 'RESOURCE_CONFLICT',
    message: `Resource ${name} conflicts with the DesignPlan. ${reason}`,
    retryable: false,
  });
}

function invalid(message: string): BridgeFault {
  return new BridgeFault({ code: 'PLAN_INVALID', message, retryable: false });
}
