import {
  NodeResultSchema,
  type CompactGeometry,
  type LayoutSnapshot,
  type NodeField,
  type NodeResult,
  type NodeSnapshot,
} from '@figma-agent/protocol';

/**
 * 将内部完整快照投影为公开的紧凑节点事实。
 * 内部快照及其 fingerprint 不参与本函数的裁剪，避免改变 Proposal 等核心校验算法。
 */
export function projectCompactNode(
  snapshot: NodeSnapshot,
  fields: readonly NodeField[],
): NodeResult {
  const selected = new Set(fields);
  const geometry = compactGeometry(snapshot.geometry);
  const layout = compactLayout(snapshot.layout);
  const text = compactText(snapshot.text);
  const visual = compactVisual(snapshot.visual);
  const assets = compactAssets(snapshot.assets);
  const component = compactComponent(snapshot.component);

  return NodeResultSchema.parse({
    name: snapshot.name,
    type: snapshot.type,
    ...(snapshot.parentId ? { parentId: snapshot.parentId } : {}),
    ...(snapshot.visible === false ? { visible: false as const } : {}),
    ...(snapshot.locked === true ? { locked: true as const } : {}),
    ...(selected.has('GEOMETRY') && geometry ? { geometry } : {}),
    ...(selected.has('LAYOUT') && layout ? { layout } : {}),
    ...(selected.has('TEXT') && text ? { text } : {}),
    ...(selected.has('VISUAL') && visual ? { visual } : {}),
    ...(selected.has('ASSETS') && assets ? { assets } : {}),
    ...(selected.has('COMPONENT') && component ? { component } : {}),
    ...(selected.has('CHILDREN')
      ? {
          children: snapshot.children.map((child) => ({
            id: child.id,
            name: child.name,
            type: child.type,
            ...(child.geometry ? { geometry: compactGeometry(child.geometry) } : {}),
          })),
        }
      : {}),
  });
}

function compactGeometry(geometry: NodeSnapshot['geometry']): CompactGeometry | undefined {
  if (!geometry) return undefined;
  const renderBounds = geometry.absoluteRenderBounds;
  return {
    local: geometry.local,
    absolute: geometry.absolute,
    // 渲染边界与普通绝对边界相同时不重复输出。
    ...(renderBounds !== undefined && !sameBounds(renderBounds, geometry.absolute)
      ? { absoluteRenderBounds: renderBounds }
      : {}),
    ...(geometry.rotation !== 0 ? { rotation: geometry.rotation } : {}),
  };
}

function compactLayout(layout: NodeSnapshot['layout']): LayoutSnapshot | undefined {
  if (!layout) return undefined;
  const padding =
    layout.padding && Object.values(layout.padding).some((value) => value !== 0)
      ? layout.padding
      : undefined;
  const constraints =
    layout.constraints &&
    (layout.constraints.horizontal !== 'MIN' || layout.constraints.vertical !== 'MIN')
      ? layout.constraints
      : undefined;
  const compact: LayoutSnapshot = {
    ...(layout.mode && layout.mode !== 'NONE' ? { mode: layout.mode } : {}),
    ...(layout.wrap && layout.wrap !== 'NO_WRAP' ? { wrap: layout.wrap } : {}),
    ...(layout.gap !== undefined && layout.gap !== 0 ? { gap: layout.gap } : {}),
    ...(padding ? { padding } : {}),
    ...(layout.sizing ? { sizing: compactObject(layout.sizing) } : {}),
    ...(layout.positioning && layout.positioning !== 'AUTO'
      ? { positioning: layout.positioning }
      : {}),
    ...(layout.item && !isEmptyObject(layout.item) ? { item: layout.item } : {}),
    ...(layout.primaryAxisAlign && layout.primaryAxisAlign !== 'MIN'
      ? { primaryAxisAlign: layout.primaryAxisAlign }
      : {}),
    ...(layout.counterAxisAlign && layout.counterAxisAlign !== 'MIN'
      ? { counterAxisAlign: layout.counterAxisAlign }
      : {}),
    ...(layout.counterAxisAlignContent && layout.counterAxisAlignContent !== 'AUTO'
      ? { counterAxisAlignContent: layout.counterAxisAlignContent }
      : {}),
    ...(layout.counterAxisSpacing !== undefined && layout.counterAxisSpacing !== 0
      ? { counterAxisSpacing: layout.counterAxisSpacing }
      : {}),
    ...(layout.itemReverseZIndex ? { itemReverseZIndex: true } : {}),
    ...(layout.strokesIncludedInLayout ? { strokesIncludedInLayout: true } : {}),
    ...(constraints ? { constraints } : {}),
    // overflow 仅保留为 Figma 静态布局提示，不能据此推导浏览器滚动契约。
    ...(layout.overflow ? { overflow: layout.overflow } : {}),
    ...(layout.grid ? { grid: layout.grid } : {}),
    ...(layout.gridItem ? { gridItem: layout.gridItem } : {}),
  };
  return isEmptyObject(compact) ? undefined : compact;
}

function compactText(text: NodeSnapshot['text']): NodeResult['text'] | undefined {
  if (!text) return undefined;
  return {
    characters: text.characters,
    ...(text.truncated ? { truncated: true } : {}),
    ...(text.fontName === undefined ? {} : { fontName: text.fontName }),
    ...(text.fontSize === undefined ? {} : { fontSize: text.fontSize }),
    ...(text.lineHeight === undefined ? {} : { lineHeight: text.lineHeight }),
    ...(!isZeroMeasurement(text.letterSpacing) && text.letterSpacing !== undefined
      ? { letterSpacing: text.letterSpacing }
      : {}),
    ...(text.textAlignHorizontal && text.textAlignHorizontal !== 'LEFT'
      ? { textAlignHorizontal: text.textAlignHorizontal }
      : {}),
    ...(text.textAlignVertical && text.textAlignVertical !== 'TOP'
      ? { textAlignVertical: text.textAlignVertical }
      : {}),
    ...(text.textAutoResize && text.textAutoResize !== 'NONE'
      ? { textAutoResize: text.textAutoResize }
      : {}),
    ...(text.textTruncation && text.textTruncation !== 'DISABLED'
      ? { textTruncation: text.textTruncation }
      : {}),
    ...(text.maxLines === undefined || text.maxLines === null ? {} : { maxLines: text.maxLines }),
    ...(!isZeroValue(text.paragraphIndent) && text.paragraphIndent !== undefined
      ? { paragraphIndent: text.paragraphIndent }
      : {}),
    ...(!isZeroValue(text.paragraphSpacing) && text.paragraphSpacing !== undefined
      ? { paragraphSpacing: text.paragraphSpacing }
      : {}),
    ...(!isZeroValue(text.listSpacing) && text.listSpacing !== undefined
      ? { listSpacing: text.listSpacing }
      : {}),
    ...(text.textCase !== undefined && text.textCase !== 'ORIGINAL'
      ? { textCase: text.textCase }
      : {}),
    ...(text.textDecoration !== undefined && text.textDecoration !== 'NONE'
      ? { textDecoration: text.textDecoration }
      : {}),
    ...(text.runs && text.runs.length > 0 ? { runs: text.runs } : {}),
    ...(text.runsTruncated ? { runsTruncated: true } : {}),
    ...(text.hasMissingFont ? { hasMissingFont: true } : {}),
  };
}

function compactVisual(visual: NodeSnapshot['visual']): NodeResult['visual'] | undefined {
  if (!visual) return undefined;
  const compact: NonNullable<NodeResult['visual']> = {
    ...(visual.opacity !== undefined && visual.opacity !== 1 ? { opacity: visual.opacity } : {}),
    ...(visual.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(visual.blendMode)
      ? { blendMode: visual.blendMode }
      : {}),
    ...(!isEmptyCollection(visual.fills) && visual.fills !== undefined
      ? { fills: visual.fills }
      : {}),
    ...(!isEmptyCollection(visual.strokes) && visual.strokes !== undefined
      ? { strokes: visual.strokes }
      : {}),
    ...(!isZeroValue(visual.strokeWeight) && visual.strokeWeight !== undefined
      ? { strokeWeight: visual.strokeWeight }
      : {}),
    ...(visual.strokeAlign ? { strokeAlign: visual.strokeAlign } : {}),
    ...(visual.dashPattern && visual.dashPattern.length > 0
      ? { dashPattern: visual.dashPattern }
      : {}),
    ...(visual.strokeCap === undefined ? {} : { strokeCap: visual.strokeCap }),
    ...(visual.strokeJoin === undefined ? {} : { strokeJoin: visual.strokeJoin }),
    ...(visual.strokeMiterLimit !== undefined && visual.strokeMiterLimit !== 4
      ? { strokeMiterLimit: visual.strokeMiterLimit }
      : {}),
    ...(visual.individualStrokeWeights
      ? { individualStrokeWeights: visual.individualStrokeWeights }
      : {}),
    ...(!isZeroValue(visual.cornerRadius) && visual.cornerRadius !== undefined
      ? { cornerRadius: visual.cornerRadius }
      : {}),
    ...(visual.cornerSmoothing ? { cornerSmoothing: visual.cornerSmoothing } : {}),
    ...(visual.cornerRadii && Object.values(visual.cornerRadii).some((value) => value !== 0)
      ? { cornerRadii: visual.cornerRadii }
      : {}),
    ...(!isEmptyCollection(visual.effects) && visual.effects !== undefined
      ? { effects: visual.effects }
      : {}),
    ...(visual.clipsContent ? { clipsContent: true } : {}),
  };
  return isEmptyObject(compact) ? undefined : compact;
}

function compactAssets(assets: NodeSnapshot['assets']): NodeResult['assets'] | undefined {
  if (!assets) return undefined;
  const imagePaints = assets.imagePaints.map((paint) => ({
    ...paint,
    ...(paint.rotation === 0 ? { rotation: undefined } : {}),
    ...(paint.opacity === 1 ? { opacity: undefined } : {}),
    ...(paint.blendMode === 'NORMAL' ? { blendMode: undefined } : {}),
    ...(paint.visible === true ? { visible: undefined } : {}),
  }));
  const exportSettings = assets.exportSettings.map((setting) => ({
    ...setting,
    ...(setting.suffix === '' ? { suffix: undefined } : {}),
  }));
  const vector =
    assets.vector && (assets.vector.pathCount > 0 || assets.vector.segmentCount > 0)
      ? assets.vector
      : undefined;
  const mask = assets.mask?.isMask ? assets.mask : undefined;
  const compact = {
    ...(imagePaints.length > 0 ? { imagePaints } : {}),
    ...(exportSettings.length > 0 ? { exportSettings } : {}),
    ...(vector ? { vector } : {}),
    ...(mask ? { mask } : {}),
  };
  return isEmptyObject(compact) ? undefined : compact;
}

function compactComponent(
  component: NodeSnapshot['component'],
): NodeResult['component'] | undefined {
  if (!component) return undefined;
  return {
    kind: component.kind,
    ...(component.mainComponentId === undefined
      ? {}
      : { mainComponentId: component.mainComponentId }),
    ...(!isEmptyCollection(component.properties) && component.properties !== undefined
      ? { properties: component.properties }
      : {}),
    ...(!isEmptyCollection(component.componentPropertyDefinitions) &&
    component.componentPropertyDefinitions !== undefined
      ? { componentPropertyDefinitions: component.componentPropertyDefinitions }
      : {}),
  };
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function sameBounds(
  first: CompactGeometry['absoluteRenderBounds'],
  second: CompactGeometry['absolute'],
): boolean {
  if (first === null || second === null) return first === second;
  if (first === undefined) return false;
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function isEmptyObject(value: object): boolean {
  return Object.keys(value).length === 0;
}

function isEmptyCollection(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.length === 0) ||
    (isPlainObject(value) && Object.keys(value).length === 0)
  );
}

function isZeroValue(value: unknown): boolean {
  return value === 0;
}

function isZeroMeasurement(value: unknown): boolean {
  return (
    value === 0 ||
    (isPlainObject(value) &&
      'value' in value &&
      typeof value.value === 'number' &&
      value.value === 0)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
