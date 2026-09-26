import type { NodeSnapshot } from '@figma-agent/protocol';

import { fingerprintValue } from './fingerprint.js';
import { toJsonValue } from './json.js';
import { serializeNodeSummary } from './node-summary.js';
import { findPage, isSceneNode } from './resolve.js';

export interface SerializeOptions {
  maxTextLength?: number;
}

export async function serializeNode(
  node: SceneNode,
  options: SerializeOptions = {},
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
    ...(await serializeComponent(node)),
    children,
    truncated: node.type === 'TEXT' && node.characters.length > maxTextLength,
  };

  return { ...base, fingerprint: fingerprintValue(toJsonValue(base)) };
}

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

export async function fingerprintNodeTree(nodes: readonly SceneNode[]): Promise<string> {
  const visit = async (node: SceneNode): Promise<unknown> => ({
    snapshot: await serializeNode(node),
    children:
      'children' in node
        ? await Promise.all(node.children.filter(isSceneNode).map((child) => visit(child)))
        : [],
  });
  return fingerprintValue(toJsonValue(await Promise.all(nodes.map((node) => visit(node)))));
}
