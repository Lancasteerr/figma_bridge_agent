import type { NodeAssetSnapshot, NodeSnapshot } from '@figma-agent/protocol';

import { fingerprintValue } from './fingerprint.js';
import { toJsonValue } from './json.js';
import { serializeNodeSummary } from './node-summary.js';
import { findPage, isSceneNode } from './resolve.js';

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

  const base = {
    ...serializeNodeSummary(node),
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
  }
  if ('layoutSizingHorizontal' in node) {
    layout.sizing = {
      horizontal: node.layoutSizingHorizontal,
      vertical: node.layoutSizingVertical,
    };
  }
  if ('layoutPositioning' in node) layout.positioning = node.layoutPositioning;
  if ('constraints' in node) layout.constraints = { ...node.constraints };
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
      hasMissingFont: node.hasMissingFont,
    },
  };
}

function serializeVisual(node: SceneNode): Pick<NodeSnapshot, 'visual'> {
  const visual: NonNullable<NodeSnapshot['visual']> = {};
  if ('opacity' in node) visual.opacity = node.opacity;
  if ('blendMode' in node) visual.blendMode = node.blendMode;
  if ('fills' in node) visual.fills = toJsonValue(node.fills);
  if ('strokes' in node) visual.strokes = toJsonValue(node.strokes);
  if ('strokeWeight' in node) visual.strokeWeight = toJsonValue(node.strokeWeight);
  if ('cornerRadius' in node) visual.cornerRadius = toJsonValue(node.cornerRadius);
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
