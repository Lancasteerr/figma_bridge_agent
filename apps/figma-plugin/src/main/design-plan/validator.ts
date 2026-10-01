import {
  BridgeFault,
  DESIGN_PLAN_MAX_DEPTH,
  DESIGN_PLAN_MAX_NODES,
  type DesignFontName,
  type DesignNode,
  type DesignPlan,
  type DesignPlanWarning,
  type DesignResourceRef,
} from '@figma-agent/protocol';

import { isInside } from '../proposal/marker.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { assetCache, type StagedAssetEntry } from '../assets/asset-cache.js';
import { prepareDesignResources, type PreparedDesignResources } from './resources.js';

export interface ValidatedDesignSource {
  roots: SceneNode[];
  cloneSources: Map<string, SceneNode>;
  assets: Map<string, StagedAssetEntry>;
  resolvedFonts: Map<string, DesignFontName>;
  warnings: DesignPlanWarning[];
  resources: PreparedDesignResources;
  instanceSources: Map<string, ComponentNode | InstanceNode>;
  existingStyles: Map<string, BaseStyle>;
  existingVariables: Map<string, Variable>;
}

/** 只读解析计划引用，所有文档写入必须留到 atomicMutation 的 mutate 阶段。 */
export async function validateDesignPlan(plan: DesignPlan): Promise<ValidatedDesignSource> {
  const roots = plan.source
    ? await Promise.all(plan.source.rootNodeIds.map(resolveCurrentPageNode))
    : [];
  assertUnique(
    roots.map((node) => node.id),
    'source root',
  );
  assertDisjointRoots(roots);

  const refs = new Set<string>();
  const cloneSources = new Map<string, SceneNode>();
  const assets = new Map<string, StagedAssetEntry>();
  const resolvedFonts = new Map<string, DesignFontName>();
  const warnings: DesignPlanWarning[] = [];
  const nodes: DesignNode[] = [];
  const instanceSources = new Map<string, ComponentNode | InstanceNode>();
  const availableFonts = await figma.listAvailableFontsAsync();
  let nodeCount = 0;

  const visit = async (node: DesignNode, depth: number): Promise<void> => {
    nodeCount += 1;
    if (nodeCount > DESIGN_PLAN_MAX_NODES) {
      throw invalid(`DesignPlan exceeds the ${DESIGN_PLAN_MAX_NODES} node limit.`);
    }
    if (depth > DESIGN_PLAN_MAX_DEPTH) {
      throw invalid(`DesignPlan exceeds the ${DESIGN_PLAN_MAX_DEPTH} depth limit.`, node.ref);
    }
    if (refs.has(node.ref)) throw invalid(`Duplicate design ref: ${node.ref}.`, node.ref);
    refs.add(node.ref);
    nodes.push(node);

    if (node.kind === 'CLONE') {
      if (!plan.source) throw invalid('CLONE nodes require a source declaration.', node.ref);
      const source = await resolveCurrentPageNode(node.sourceNodeId);
      if (!roots.some((root) => isInside(root, source))) {
        throw invalid(`Clone source ${source.id} is outside declared source roots.`, node.ref);
      }
      if (hasInstanceAncestorWithinRoots(source, roots)) {
        throw invalid(`Clone source ${source.id} is inside an Instance.`, node.ref);
      }
      cloneSources.set(node.ref, source);
      return;
    }

    if (node.kind === 'TEXT') {
      validateTextRanges(node);
      resolveFont(`${node.ref}:base`, node.ref, node.text.font);
      for (const [index, range] of node.text.ranges.entries()) {
        if (range.font) resolveFont(`${node.ref}:range:${index}`, node.ref, range.font);
      }
    }

    if (node.kind === 'INSTANCE') {
      const candidate = await resolveCurrentPageNode(node.source.nodeId);
      if (node.source.mode === 'CREATE_INSTANCE') {
        const component =
          candidate.type === 'COMPONENT'
            ? candidate
            : candidate.type === 'INSTANCE'
              ? await candidate.getMainComponentAsync()
              : null;
        if (!component) {
          throw invalid(
            `INSTANCE ${node.ref} requires a current-page Component or an Instance with an accessible main component.`,
            node.ref,
          );
        }
        instanceSources.set(node.ref, component);
        return;
      }
      if (node.source.mode === 'CLONE_INSTANCE' && candidate.type !== 'INSTANCE') {
        throw invalid(`INSTANCE ${node.ref} requires a current-page Instance to clone.`, node.ref);
      }
      instanceSources.set(node.ref, candidate as InstanceNode);
    }

    if (node.kind === 'IMAGE' || node.kind === 'SVG') {
      const asset = assetCache.get(node.asset.assetId, node.asset.sha256);
      if (node.kind === 'IMAGE' && asset.kind !== 'RASTER') {
        throw invalid(`IMAGE ${node.ref} requires a raster asset.`, node.ref);
      }
      if (node.kind === 'SVG' && asset.kind !== 'SVG') {
        throw invalid(`SVG ${node.ref} requires an SVG asset.`, node.ref);
      }
      assets.set(node.ref, asset);
    }

    if (node.kind === 'FRAME') {
      for (const child of node.children) await visit(child, depth + 1);
    }
  };

  await visit(plan.root, 1);
  for (const resource of plan.resources) {
    if (refs.has(resource.ref))
      throw invalid(`Duplicate design ref: ${resource.ref}.`, resource.ref);
    refs.add(resource.ref);
    if (resource.kind === 'TEXT_STYLE') {
      resolveFont(`resource:${resource.ref}:font`, resource.ref, resource.font);
    }
    if (resource.kind === 'VARIABLE_COLLECTION') {
      for (const variable of resource.variables) {
        if (refs.has(variable.ref))
          throw invalid(`Duplicate design ref: ${variable.ref}.`, variable.ref);
        refs.add(variable.ref);
      }
    }
  }
  const resources = await prepareDesignResources(plan, resolvedFonts);
  const existingStyles = new Map<string, BaseStyle>();
  const existingVariables = new Map<string, Variable>();
  for (const node of nodes) {
    await validateBindings(node, resources, existingStyles, existingVariables);
  }
  return {
    roots,
    cloneSources,
    assets,
    resolvedFonts,
    warnings,
    resources,
    instanceSources,
    existingStyles,
    existingVariables,
  };

  function resolveFont(
    key: string,
    ref: string,
    selection: {
      requested: DesignFontName;
      fallbacks: DesignFontName[];
      policy: 'STRICT' | 'ALLOW_FALLBACK';
    },
  ): void {
    const candidates =
      selection.policy === 'ALLOW_FALLBACK'
        ? [selection.requested, ...selection.fallbacks]
        : [selection.requested];
    const selected = candidates.find((candidate) =>
      availableFonts.some(
        (font) =>
          font.fontName.family === candidate.family && font.fontName.style === candidate.style,
      ),
    );
    if (!selected) {
      throw new BridgeFault({
        code: 'MISSING_FONT',
        message: `No permitted font is available for ${ref}: ${candidates
          .map((font) => `${font.family} ${font.style}`)
          .join(', ')}.`,
        retryable: true,
        details: { ref },
      });
    }
    resolvedFonts.set(key, selected);
    if (
      selected.family !== selection.requested.family ||
      selected.style !== selection.requested.style
    ) {
      warnings.push({
        code: 'FONT_FALLBACK',
        message: `${selection.requested.family} ${selection.requested.style} was replaced by ${selected.family} ${selected.style}.`,
        ref,
      });
    }
  }
}

async function validateBindings(
  node: DesignNode,
  resources: PreparedDesignResources,
  existingStyles: Map<string, BaseStyle>,
  existingVariables: Map<string, Variable>,
): Promise<void> {
  if (node.kind === 'CLONE') return;
  const expectedTypes: Array<[DesignResourceRef | undefined, StyleType, string]> = [
    [node.styleBindings?.fill, 'PAINT', 'fill'],
    [node.styleBindings?.stroke, 'PAINT', 'stroke'],
    [node.styleBindings?.text, 'TEXT', 'text'],
    [node.styleBindings?.effect, 'EFFECT', 'effect'],
    [node.styleBindings?.grid, 'GRID', 'grid'],
  ];
  if (node.styleBindings?.text && node.kind !== 'TEXT') {
    throw invalid(`Text style binding requires a TEXT node.`, node.ref);
  }
  if (node.styleBindings?.grid && node.kind !== 'FRAME') {
    throw invalid(`Grid style binding requires a FRAME node.`, node.ref);
  }
  for (const [reference, expectedType, field] of expectedTypes) {
    if (!reference) continue;
    if ('ref' in reference) {
      if (resources.styleTypes.get(reference.ref) !== expectedType) {
        throw invalid(`Style ref ${reference.ref} is incompatible with ${field}.`, node.ref);
      }
    } else {
      const style = await figma.getStyleByIdAsync(reference.id);
      if (!style || style.type !== expectedType) {
        throw invalid(
          `Style ${reference.id} is unavailable or incompatible with ${field}.`,
          node.ref,
        );
      }
      existingStyles.set(reference.id, style);
    }
  }

  for (const binding of node.variableBindings ?? []) {
    if (binding.target === 'FILL_COLOR' && node.styleBindings?.fill) {
      throw invalid(
        'A node cannot bind a fill style and a fill color variable together.',
        node.ref,
      );
    }
    if (binding.target === 'STROKE_COLOR' && node.styleBindings?.stroke) {
      throw invalid(
        'A node cannot bind a stroke style and a stroke color variable together.',
        node.ref,
      );
    }
    if (
      binding.target === 'PROPERTY' &&
      ['itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].includes(
        binding.field,
      ) &&
      node.kind !== 'FRAME'
    ) {
      throw invalid(`${binding.field} variable binding requires a FRAME node.`, node.ref);
    }
    if (
      binding.target === 'PROPERTY' &&
      ['fontSize', 'lineHeight', 'letterSpacing'].includes(binding.field) &&
      node.kind !== 'TEXT'
    ) {
      throw invalid(`${binding.field} variable binding requires a TEXT node.`, node.ref);
    }
    const expectedType: VariableResolvedDataType =
      binding.target === 'FILL_COLOR' || binding.target === 'STROKE_COLOR' ? 'COLOR' : 'FLOAT';
    const reference = binding.variable;
    if ('ref' in reference) {
      if (resources.variableTypes.get(reference.ref) !== expectedType) {
        throw invalid(
          `Variable ref ${reference.ref} is incompatible with ${binding.target}.`,
          node.ref,
        );
      }
    } else {
      const variable = await figma.variables.getVariableByIdAsync(reference.id);
      if (!variable || variable.resolvedType !== expectedType) {
        throw invalid(`Variable ${reference.id} is unavailable or incompatible.`, node.ref);
      }
      existingVariables.set(reference.id, variable);
    }
  }
}

/** apply 的只读预检阶段加载全部字体，确保进入 Undo 边界后不会因字体失败。 */
export async function preloadDesignFonts(source: ValidatedDesignSource): Promise<void> {
  const unique = new Map(
    [...source.resolvedFonts.values()].map((font) => [
      `${font.family}\u0000${font.style}\u0000${JSON.stringify(font.variationSettings ?? {})}`,
      font,
    ]),
  );
  try {
    await Promise.all(
      [...unique.values()].map((font) =>
        figma.loadFontAsync(
          font.variationSettings
            ? { family: font.family, style: font.style, variationSettings: font.variationSettings }
            : { family: font.family, style: font.style },
        ),
      ),
    );
  } catch (error) {
    throw new BridgeFault({
      code: 'MISSING_FONT',
      message: error instanceof Error ? error.message : 'A DesignPlan font could not be loaded.',
      retryable: true,
    });
  }
}

function validateTextRanges(node: Extract<DesignNode, { kind: 'TEXT' }>): void {
  for (const range of node.text.ranges) {
    if (range.end <= range.start || range.end > node.text.characters.length) {
      throw invalid(`Text range ${range.start}:${range.end} is outside ${node.ref}.`, node.ref);
    }
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw invalid(`Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function assertDisjointRoots(roots: SceneNode[]): void {
  for (const root of roots) {
    for (const other of roots) {
      if (root !== other && isInside(other, root)) {
        throw invalid(`Source roots cannot contain both ${other.id} and ${root.id}.`);
      }
    }
  }
}

function hasInstanceAncestorWithinRoots(node: SceneNode, roots: SceneNode[]): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'INSTANCE') return true;
    if (roots.some((root) => root.id === current?.id)) return false;
    current = current.parent;
  }
  return false;
}

function invalid(message: string, ref?: string): BridgeFault {
  return new BridgeFault({
    code: 'PLAN_INVALID',
    message,
    retryable: false,
    ...(ref ? { details: { ref } } : {}),
  });
}
