import {
  BridgeFault,
  type FrameLayoutItem,
  type LayoutItem,
  type LayoutPlan,
  type LayoutSpec,
  type SizingSpec,
} from '@figma-agent/protocol';

import { mapClonedSubtree } from '../proposal/id-map.js';
import { markProposal } from '../proposal/marker.js';
import type { ValidatedLayoutSource } from './validator.js';

export interface ExecutedLayoutPlan {
  /** 执行后的 Proposal 根、源到副本映射和可选 Component ID。 */
  root: SceneNode;
  idMap: Record<string, string>;
  componentId?: string;
}

/**
 * 在源节点副本上执行已验证的布局计划。
 * 所有中间节点先隐藏，失败时删除唯一根节点，确保原稿和半成品都不被留下。
 */
export async function executeLayoutPlan(
  plan: LayoutPlan,
  source: ValidatedLayoutSource,
): Promise<ExecutedLayoutPlan> {
  const idMap: Record<string, string> = {};
  const clones = new Map<string, SceneNode>();
  let root: SceneNode | undefined;
  try {
    if (plan.root.kind === 'existing-container') {
      const sourceNodeId = plan.root.sourceNodeId;
      const original = source.roots.find((node) => node.id === sourceNodeId)!;
      const clone = original.clone();
      figma.currentPage.appendChild(clone);
      mapClonedSubtree(original, clone, idMap);
      indexCloneMap(original, clone, clones);
      root = clone;
    } else {
      const frame = figma.createFrame();
      figma.currentPage.appendChild(frame);
      frame.name = plan.root.name;
      frame.fills = [];
      frame.clipsContent = false;
      root = frame;
      for (const original of source.roots) {
        const clone = original.clone();
        frame.appendChild(clone);
        mapClonedSubtree(original, clone, idMap);
        indexCloneMap(original, clone, clones);
      }
    }

    root.visible = false;
    root.name = `${plan.root.name}${plan.proposal.nameSuffix}`;
    await placeItems(root, plan.root.children, clones);
    applyContainerLayout(root, plan.root.layout, plan.root.sizing);
    positionBesideSources(root, source.roots, plan.proposal.offsetX, plan.proposal.offsetY);
    markProposal(root, plan.source.rootNodeIds);

    let componentId: string | undefined;
    if (plan.convertToComponent) {
      if (root.type !== 'FRAME') {
        throw invalid('Component conversion requires a Frame plan root.', root.id);
      }
      const previousId = root.id;
      const component = figma.createComponentFromNode(root);
      // 根 Frame 被替换后，idMap 中指向旧根的值也必须指向新 Component。
      root = component;
      for (const [sourceId, cloneId] of Object.entries(idMap)) {
        if (cloneId === previousId) idMap[sourceId] = component.id;
      }
      markProposal(component, plan.source.rootNodeIds);
      componentId = component.id;
    }

    root.visible = true;
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    return { root, idMap, ...(componentId ? { componentId } : {}) };
  } catch (error) {
    if (root && !root.removed) root.remove();
    throw error;
  }
}

async function placeItems(
  parent: SceneNode,
  items: LayoutItem[],
  clones: Map<string, SceneNode>,
): Promise<void> {
  // 深度优先放置，先建立父容器再应用其布局，保持声明式树的顺序。
  if (!('appendChild' in parent))
    throw invalid(`Node ${parent.id} cannot contain plan items.`, parent.id);
  for (const item of items) {
    if (item.kind === 'existing') {
      const node = clones.get(item.sourceNodeId);
      if (!node) throw invalid(`Clone for ${item.sourceNodeId} is unavailable.`, item.sourceNodeId);
      parent.appendChild(node);
      applyChildLayout(node, item.sizing, item.positioning, item.absolute);
      continue;
    }
    const frame = createPlanFrame(item);
    parent.appendChild(frame);
    await placeItems(frame, item.children, clones);
    applyContainerLayout(frame, item.layout, item.sizing);
  }
}

function createPlanFrame(item: FrameLayoutItem): FrameNode {
  const frame = figma.createFrame();
  frame.name = item.name;
  frame.fills = [];
  frame.clipsContent = false;
  return frame;
}

function applyContainerLayout(node: SceneNode, layout: LayoutSpec, sizing?: SizingSpec): void {
  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    throw invalid(`Node ${node.id} does not support Auto Layout.`, node.id);
  }
  node.layoutMode = layout.mode;
  node.layoutWrap = 'NO_WRAP';
  node.itemSpacing = layout.gap;
  node.paddingTop = layout.padding.top;
  node.paddingRight = layout.padding.right;
  node.paddingBottom = layout.padding.bottom;
  node.paddingLeft = layout.padding.left;
  node.primaryAxisAlignItems = layout.primaryAxisAlign;
  node.counterAxisAlignItems = layout.counterAxisAlign;
  applySizing(node, sizing);
}

function applyChildLayout(
  node: SceneNode,
  sizing?: SizingSpec,
  positioning?: 'AUTO' | 'ABSOLUTE',
  absolute?: { x: number; y: number },
): void {
  // ABSOLUTE 节点脱离 Auto Layout 流，但仍可通过 absolute 恢复指定的 local 坐标。
  if (positioning && 'layoutPositioning' in node) node.layoutPositioning = positioning;
  if (absolute) {
    node.x = absolute.x;
    node.y = absolute.y;
  }
  applySizing(node, sizing);
}

function applySizing(node: SceneNode, sizing?: SizingSpec): void {
  if (!sizing || !('layoutSizingHorizontal' in node)) return;
  if (sizing.horizontal) node.layoutSizingHorizontal = sizing.horizontal;
  if (sizing.vertical) node.layoutSizingVertical = sizing.vertical;
}

function indexCloneMap(
  original: SceneNode,
  clone: SceneNode,
  output: Map<string, SceneNode>,
): void {
  // Figma clone 保留子节点顺序，因此可以递归建立同构映射。
  output.set(original.id, clone);
  if (!('children' in original) || !('children' in clone)) return;
  const originals = original.children.filter(isScene);
  const clones = clone.children.filter(isScene);
  for (let index = 0; index < Math.min(originals.length, clones.length); index += 1) {
    indexCloneMap(originals[index]!, clones[index]!, output);
  }
}

function positionBesideSources(
  root: SceneNode,
  sources: SceneNode[],
  offsetX: number,
  offsetY: number,
): void {
  // 使用所有源节点的绝对包围盒，把 Proposal 放到源内容右侧并保留 y 基线。
  const boxes = sources.map((node) => node.absoluteBoundingBox ?? node);
  root.x = Math.max(...boxes.map((box) => box.x + box.width)) + offsetX;
  root.y = Math.min(...boxes.map((box) => box.y)) + offsetY;
}

function isScene(node: BaseNode): node is SceneNode {
  return node.type !== 'DOCUMENT' && node.type !== 'PAGE' && 'x' in node;
}

function invalid(message: string, nodeId?: string): BridgeFault {
  return new BridgeFault({ code: 'PLAN_INVALID', message, retryable: false, nodeId });
}
