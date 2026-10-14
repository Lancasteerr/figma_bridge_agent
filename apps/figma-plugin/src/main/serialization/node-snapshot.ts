import type { NodeAssetSnapshot, NodeSnapshot } from '@figma-agent/protocol';

import { fingerprintValue } from './fingerprint.js';
import { toJsonValue } from './json.js';
import { serializeNodeSummary } from './node-summary.js';
import { findPage, isSceneNode } from './resolve.js';

const MAX_TEXT_STYLE_RUNS = 64;
const TEXT_RUN_FIELDS = [
  'fontName',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'fills',
  'hyperlink',
  'textStyleId',
  'fillStyleId',
] as const;

export interface SerializeOptions {
  /** 文本限制只影响快照，不会修改 Figma 中的原始 characters。 */
  maxTextLength?: number;
}

interface ImageSizeResult {
  imageSize?: { width: number; height: number };
  imageSizeUnavailable?: true;
  imageSizeError?: 'IMAGE_NOT_FOUND' | 'QUERY_FAILED';
}

/** 同一次读取共用图片尺寸 Promise，确保相同 imageHash 最多查询一次。 */
export interface SerializeContext {
  imageSizes: Map<string, Promise<ImageSizeResult>>;
}

export function createSerializeContext(): SerializeContext {
  return { imageSizes: new Map() };
}

/**
 * 生成包含布局、文本、视觉和组件信息的规范化节点快照。
 * children 只保留摘要，完整子树由 getTree 按调用方限制递归展开。
 */
export async function serializeNode(
  node: SceneNode,
  options: SerializeOptions = {},
  context: SerializeContext = createSerializeContext(),
): Promise<NodeSnapshot> {
  const maxTextLength = options.maxTextLength ?? 2_000;
  const page = findPage(node);
  if (!page) throw new Error(`Node ${node.id} has no page.`);
  const children =
    'children' in node ? node.children.filter(isSceneNode).map(serializeNodeSummary) : [];
  const summary = serializeNodeSummary(node);

  const base = {
    ...summary,
    geometry: serializeDetailedGeometry(node),
    pageId: page.id,
    ...('visible' in node ? { visible: node.visible } : {}),
    ...('locked' in node ? { locked: node.locked } : {}),
    ...serializeLayout(node),
    ...serializeText(node, maxTextLength),
    ...serializeVisual(node),
    ...(await serializeAssets(node, context)),
    ...(await serializeComponent(node)),
    children,
    truncated: node.type === 'TEXT' && node.characters.length > maxTextLength,
  };

  return { ...base, fingerprint: fingerprintValue(toJsonValue(base)) };
}

/** 在普通几何之外补充真实渲染边界，轻量树仍复用不含该字段的摘要。 */
function serializeDetailedGeometry(node: SceneNode): NodeSnapshot['geometry'] {
  const geometry = serializeNodeSummary(node).geometry!;
  const renderBounds = 'absoluteRenderBounds' in node ? node.absoluteRenderBounds : undefined;
  return {
    ...geometry,
    ...(renderBounds === undefined
      ? {}
      : {
          absoluteRenderBounds: renderBounds
            ? {
                x: renderBounds.x,
                y: renderBounds.y,
                width: renderBounds.width,
                height: renderBounds.height,
              }
            : null,
        }),
  };
}

/** 提取素材相关的 Figma 事实，不在插件内推断素材应由代码还是文件实现。 */
async function serializeAssets(
  node: SceneNode,
  context: SerializeContext,
): Promise<Pick<NodeSnapshot, 'assets'>> {
  const imagePaints: NodeAssetSnapshot['imagePaints'] = [];
  for (const [paintSlot, value] of [
    ['FILLS', 'fills' in node ? node.fills : undefined],
    ['STROKES', 'strokes' in node ? node.strokes : undefined],
  ] as const) {
    // mixed Paint 不是数组；显式跳过，原始 mixed 状态仍保留在 visual 中。
    if (!Array.isArray(value)) continue;
    for (const [paintIndex, paint] of value.entries()) {
      if (paint.type !== 'IMAGE') continue;
      const imageHash = paint.imageHash ?? '';
      const sizeResult = imageHash
        ? await getImageSize(imageHash, context)
        : { imageSizeUnavailable: true as const, imageSizeError: 'EMPTY_IMAGE_HASH' as const };
      imagePaints.push({
        paintSlot,
        paintIndex,
        imageHash,
        ...sizeResult,
        scaleMode: paint.scaleMode,
        ...(paint.imageTransform
          ? { imageTransform: paint.imageTransform.map((row: readonly number[]) => [...row]) }
          : {}),
        ...(paint.scalingFactor === undefined ? {} : { scalingFactor: paint.scalingFactor }),
        ...(paint.rotation === undefined ? {} : { rotation: paint.rotation }),
        ...(paint.filters === undefined ? {} : { filters: toJsonValue(paint.filters) }),
        ...(paint.opacity === undefined ? {} : { opacity: paint.opacity }),
        ...(paint.blendMode === undefined ? {} : { blendMode: paint.blendMode }),
        ...(paint.visible === undefined ? {} : { visible: paint.visible }),
      });
    }
  }

  const exportSettings: NodeAssetSnapshot['exportSettings'] = [];
  if ('exportSettings' in node) {
    for (const setting of node.exportSettings) {
      if (!['PNG', 'JPG', 'SVG', 'PDF'].includes(setting.format)) continue;
      exportSettings.push({
        format: setting.format as 'PNG' | 'JPG' | 'SVG' | 'PDF',
        ...(setting.suffix === undefined ? {} : { suffix: setting.suffix }),
        ...('constraint' in setting && setting.constraint
          ? { constraint: { ...setting.constraint } }
          : {}),
        ...(setting.contentsOnly === undefined ? {} : { contentsOnly: setting.contentsOnly }),
        ...(setting.useAbsoluteBounds === undefined
          ? {}
          : { useAbsoluteBounds: setting.useAbsoluteBounds }),
      });
    }
  }

  const vector =
    'vectorPaths' in node && 'vectorNetwork' in node
      ? { pathCount: node.vectorPaths.length, segmentCount: node.vectorNetwork.segments.length }
      : undefined;
  const mask =
    'isMask' in node
      ? { isMask: node.isMask, ...('maskType' in node ? { maskType: node.maskType } : {}) }
      : undefined;
  return {
    assets: {
      imagePaints,
      exportSettings,
      ...(vector ? { vector } : {}),
      ...(mask ? { mask } : {}),
    },
  };
}

async function getImageSize(
  imageHash: string,
  context: SerializeContext,
): Promise<ImageSizeResult> {
  let pending = context.imageSizes.get(imageHash);
  if (!pending) {
    pending = (async () => {
      try {
        const image = figma.getImageByHash(imageHash);
        if (!image) {
          return {
            imageSizeUnavailable: true as const,
            imageSizeError: 'IMAGE_NOT_FOUND' as const,
          };
        }
        return { imageSize: await image.getSizeAsync() };
      } catch {
        return { imageSizeUnavailable: true as const, imageSizeError: 'QUERY_FAILED' as const };
      }
    })();
    context.imageSizes.set(imageHash, pending);
  }
  return await pending;
}

/** 只读取 Figma 实际支持的布局属性，避免对不同节点类型做危险的强制访问。 */
function serializeLayout(node: SceneNode): Pick<NodeSnapshot, 'layout'> | Record<string, never> {
  const layout: NonNullable<NodeSnapshot['layout']> = {};
  if ('layoutMode' in node) {
    layout.mode = node.layoutMode;
    layout.gap = node.itemSpacing;
    layout.padding = {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    };
    layout.primaryAxisAlign = node.primaryAxisAlignItems;
    layout.counterAxisAlign = node.counterAxisAlignItems;
    if ('layoutWrap' in node) layout.wrap = node.layoutWrap;
    if ('counterAxisAlignContent' in node) {
      layout.counterAxisAlignContent = node.counterAxisAlignContent;
    }
    if ('counterAxisSpacing' in node && node.counterAxisSpacing !== null) {
      layout.counterAxisSpacing = node.counterAxisSpacing;
    }
    if ('itemReverseZIndex' in node && node.itemReverseZIndex) layout.itemReverseZIndex = true;
    if ('strokesIncludedInLayout' in node && node.strokesIncludedInLayout) {
      layout.strokesIncludedInLayout = true;
    }
    if (node.layoutMode === 'GRID' && 'gridRowCount' in node) {
      layout.grid = {
        rowCount: node.gridRowCount,
        columnCount: node.gridColumnCount,
        rowGap: node.gridRowGap,
        columnGap: node.gridColumnGap,
        rowSizes: toJsonValue(node.gridRowSizes),
        columnSizes: toJsonValue(node.gridColumnSizes),
        autoTracks: node.gridAutoTracks,
        itemsPositioning: node.gridItemsPositioning,
      };
    }
  }
  if ('layoutSizingHorizontal' in node) {
    layout.sizing = {
      horizontal: node.layoutSizingHorizontal,
      vertical: node.layoutSizingVertical,
      ...('minWidth' in node && node.minWidth !== null ? { minWidth: node.minWidth } : {}),
      ...('maxWidth' in node && node.maxWidth !== null ? { maxWidth: node.maxWidth } : {}),
      ...('minHeight' in node && node.minHeight !== null ? { minHeight: node.minHeight } : {}),
      ...('maxHeight' in node && node.maxHeight !== null ? { maxHeight: node.maxHeight } : {}),
    };
  }
  if ('layoutPositioning' in node) layout.positioning = node.layoutPositioning;
  if ('layoutAlign' in node || 'layoutGrow' in node) {
    const align = 'layoutAlign' in node ? node.layoutAlign : undefined;
    const grow =
      'layoutGrow' in node && typeof node.layoutGrow === 'number' ? node.layoutGrow : undefined;
    if ((align !== undefined && align !== 'INHERIT') || (grow !== undefined && grow !== 0)) {
      layout.item = {
        ...(align !== undefined && align !== 'INHERIT' ? { align } : {}),
        ...(grow !== undefined && grow !== 0 ? { grow } : {}),
      };
    }
  }
  if ('constraints' in node) layout.constraints = { ...node.constraints };
  if ('overflowDirection' in node) {
    const fixedChildCount = node.numberOfFixedChildren;
    if (node.overflowDirection !== 'NONE' || fixedChildCount > 0) {
      layout.overflow = { direction: node.overflowDirection, fixedChildCount };
    }
  }
  const parent = node.parent;
  if (
    parent &&
    isSceneNode(parent) &&
    'layoutMode' in parent &&
    parent.layoutMode === 'GRID' &&
    'gridRowAnchorIndex' in node
  ) {
    layout.gridItem = {
      rowAnchorIndex: node.gridRowAnchorIndex,
      columnAnchorIndex: node.gridColumnAnchorIndex,
      rowSpan: node.gridRowSpan,
      columnSpan: node.gridColumnSpan,
      horizontalAlign: node.gridChildHorizontalAlign,
      verticalAlign: node.gridChildVerticalAlign,
    };
  }
  return Object.keys(layout).length > 0 ? { layout } : {};
}

function serializeText(
  node: SceneNode,
  max: number,
): Pick<NodeSnapshot, 'text'> | Record<string, never> {
  // Figma 的 mixed 值和缺失字体都通过 toJsonValue/标志位保留在快照中。
  if (node.type !== 'TEXT') return {};
  return {
    text: {
      characters: node.characters.slice(0, max),
      truncated: node.characters.length > max,
      fontName: toJsonValue(node.fontName),
      fontSize: toJsonValue(node.fontSize),
      lineHeight: toJsonValue(node.lineHeight),
      letterSpacing: toJsonValue(node.letterSpacing),
      textAlignHorizontal: node.textAlignHorizontal,
      textAlignVertical: node.textAlignVertical,
      textAutoResize: node.textAutoResize,
      textTruncation: node.textTruncation,
      maxLines: node.maxLines,
      paragraphIndent: toJsonValue(node.paragraphIndent),
      paragraphSpacing: toJsonValue(node.paragraphSpacing),
      listSpacing: toJsonValue(node.listSpacing),
      textCase: toJsonValue(node.textCase),
      textDecoration: toJsonValue(node.textDecoration),
      ...serializeTextRuns(node, max),
      hasMissingFont: node.hasMissingFont,
    },
  };
}

/** 仅在基础排版值为 mixed 时返回有界样式区间，避免普通文本重复相同样式。 */
function serializeTextRuns(
  node: TextNode,
  maxTextLength: number,
): Pick<NonNullable<NodeSnapshot['text']>, 'runs' | 'runsTruncated'> {
  const mixed = [
    node.fontName,
    node.fontSize,
    node.lineHeight,
    node.letterSpacing,
    node.paragraphIndent,
    node.paragraphSpacing,
    node.listSpacing,
    node.textCase,
    node.textDecoration,
    node.fills,
    node.textStyleId,
    node.fillStyleId,
    node.hyperlink,
  ].some((value) => typeof value === 'symbol');
  const end = Math.min(node.characters.length, maxTextLength);
  if (!mixed || end === 0) return {};

  const segments = node.getStyledTextSegments([...TEXT_RUN_FIELDS], 0, end);
  const runs = segments.slice(0, MAX_TEXT_STYLE_RUNS).map((segment) => ({
    start: segment.start,
    end: segment.end,
    fontName: toJsonValue(segment.fontName),
    fontSize: segment.fontSize,
    fontWeight: segment.fontWeight,
    lineHeight: toJsonValue(segment.lineHeight),
    letterSpacing: toJsonValue(segment.letterSpacing),
    textCase: segment.textCase,
    textDecoration: segment.textDecoration,
    fills: toJsonValue(segment.fills),
    ...(segment.hyperlink ? { hyperlink: toJsonValue(segment.hyperlink) } : {}),
    ...(segment.textStyleId ? { textStyleId: segment.textStyleId } : {}),
    ...(segment.fillStyleId ? { fillStyleId: segment.fillStyleId } : {}),
  }));
  return {
    runs,
    ...(segments.length > MAX_TEXT_STYLE_RUNS || end < node.characters.length
      ? { runsTruncated: true as const }
      : {}),
  };
}

function serializeVisual(node: SceneNode): Pick<NodeSnapshot, 'visual'> {
  const visual: NonNullable<NodeSnapshot['visual']> = {};
  if ('opacity' in node) visual.opacity = node.opacity;
  if ('blendMode' in node) visual.blendMode = node.blendMode;
  if ('fills' in node) visual.fills = toJsonValue(node.fills);
  if ('strokes' in node) visual.strokes = toJsonValue(node.strokes);
  if ('strokeWeight' in node) visual.strokeWeight = toJsonValue(node.strokeWeight);
  if ('strokeAlign' in node && node.strokeAlign !== 'CENTER') visual.strokeAlign = node.strokeAlign;
  if ('dashPattern' in node && node.dashPattern.length > 0) {
    visual.dashPattern = [...node.dashPattern];
  }
  if ('strokeCap' in node && (typeof node.strokeCap === 'symbol' || node.strokeCap !== 'NONE')) {
    visual.strokeCap = toJsonValue(node.strokeCap);
  }
  if (
    'strokeJoin' in node &&
    (typeof node.strokeJoin === 'symbol' || node.strokeJoin !== 'MITER')
  ) {
    visual.strokeJoin = toJsonValue(node.strokeJoin);
  }
  if ('strokeMiterLimit' in node && node.strokeJoin === 'MITER') {
    visual.strokeMiterLimit = node.strokeMiterLimit;
  }
  if (
    'strokeTopWeight' in node &&
    (typeof node.strokeWeight === 'symbol' ||
      new Set([
        node.strokeTopWeight,
        node.strokeRightWeight,
        node.strokeBottomWeight,
        node.strokeLeftWeight,
      ]).size > 1)
  ) {
    visual.individualStrokeWeights = {
      top: node.strokeTopWeight,
      right: node.strokeRightWeight,
      bottom: node.strokeBottomWeight,
      left: node.strokeLeftWeight,
    };
  }
  if ('cornerRadius' in node) visual.cornerRadius = toJsonValue(node.cornerRadius);
  if ('cornerSmoothing' in node && node.cornerSmoothing !== 0) {
    visual.cornerSmoothing = node.cornerSmoothing;
  }
  if ('topLeftRadius' in node) {
    const radii = [
      node.topLeftRadius,
      node.topRightRadius,
      node.bottomRightRadius,
      node.bottomLeftRadius,
    ];
    if (typeof node.cornerRadius === 'symbol' || new Set(radii).size > 1) {
      visual.cornerRadii = {
        topLeft: node.topLeftRadius,
        topRight: node.topRightRadius,
        bottomRight: node.bottomRightRadius,
        bottomLeft: node.bottomLeftRadius,
      };
    }
  }
  if ('effects' in node) visual.effects = toJsonValue(node.effects);
  if ('clipsContent' in node) visual.clipsContent = node.clipsContent;
  return { visual };
}

async function serializeComponent(
  node: SceneNode,
): Promise<Pick<NodeSnapshot, 'component'> | Record<string, never>> {
  // Instance 的 main component 需要异步解析；普通节点不应触发额外 API 调用。
  if (node.type === 'INSTANCE') {
    const main = await node.getMainComponentAsync();
    return {
      component: {
        kind: 'INSTANCE',
        mainComponentId: main?.id ?? null,
        properties: toJsonValue(node.componentProperties),
      },
    };
  }
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return {
      component: {
        kind: node.type,
        componentPropertyDefinitions: toJsonValue(node.componentPropertyDefinitions),
      },
    };
  }
  return {};
}

/** 深度遍历节点和所有场景子节点，生成 Proposal 变更前后的稳定指纹。 */
export async function fingerprintNodeTree(nodes: readonly SceneNode[]): Promise<string> {
  const context = createSerializeContext();
  const visit = async (node: SceneNode): Promise<unknown> => ({
    snapshot: await serializeNode(node, {}, context),
    children:
      'children' in node
        ? await Promise.all(node.children.filter(isSceneNode).map((child) => visit(child)))
        : [],
  });
  return fingerprintValue(toJsonValue(await Promise.all(nodes.map((node) => visit(node)))));
}
