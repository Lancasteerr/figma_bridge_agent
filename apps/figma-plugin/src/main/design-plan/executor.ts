import {
  BridgeFault,
  type DesignNode,
  type DesignPlacement,
  type DesignPlan,
  type LayoutSpec,
  type SizingSpec,
} from '@figma-agent/protocol';

import { markProposal } from '../proposal/marker.js';
import type { ValidatedDesignSource } from './validator.js';

export interface ExecutedDesignPlan {
  root: FrameNode;
  refMap: Record<string, string>;
}

/** 在隐藏 Frame 内构建完整树，调用方负责用 atomicMutation 提供失败回滚。 */
export async function executeDesignPlan(
  plan: DesignPlan,
  source: ValidatedDesignSource,
): Promise<ExecutedDesignPlan> {
  const refMap: Record<string, string> = {};
  const root = figma.createFrame();
  root.visible = false;
  root.name = plan.proposal.name;
  figma.currentPage.appendChild(root);
  applyGeometry(root, plan.root.geometry);
  root.fills = [];

  try {
    for (const child of plan.root.children) await appendNode(root, child, source, refMap);
    applyContainerLayout(root, plan.root.layout, plan.root.placement?.sizing);
    applyPlacement(root, plan.root.placement);
    positionRoot(root, plan, source.roots);
    refMap[plan.root.ref] = root.id;
    markProposal(root, plan.source?.rootNodeIds ?? []);
    root.visible = true;
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    return { root, refMap };
  } catch (error) {
    if (!root.removed) root.remove();
    throw error;
  }
}

async function appendNode(
  parent: ChildrenMixin & SceneNode,
  spec: DesignNode,
  source: ValidatedDesignSource,
  refMap: Record<string, string>,
): Promise<void> {
  let node: SceneNode;
  if (spec.kind === 'CLONE') {
    const original = source.cloneSources.get(spec.ref);
    if (!original) throw invalid(`Clone source for ${spec.ref} is unavailable.`);
    node = original.clone();
    if (spec.name) node.name = spec.name;
    parent.appendChild(node);
    if (spec.geometry) applyGeometry(node, spec.geometry);
    applyPlacement(node, spec.placement);
  } else {
    node = createBasicNode(spec.kind);
    node.name = spec.name;
    parent.appendChild(node);
    applyGeometry(node, spec.geometry);
    if (spec.kind === 'FRAME' && node.type === 'FRAME') {
      node.fills = [];
      for (const child of spec.children) await appendNode(node, child, source, refMap);
      applyContainerLayout(node, spec.layout, spec.placement?.sizing);
    }
    applyPlacement(node, spec.placement);
  }
  refMap[spec.ref] = node.id;
}

function createBasicNode(kind: Exclude<DesignNode['kind'], 'CLONE'>): SceneNode {
  if (kind === 'FRAME') return figma.createFrame();
  if (kind === 'RECTANGLE') return figma.createRectangle();
  if (kind === 'ELLIPSE') return figma.createEllipse();
  if (kind === 'LINE') return figma.createLine();
  throw invalid(`Unsupported basic node kind: ${String(kind)}.`);
}

function applyGeometry(
  node: SceneNode,
  geometry: { x: number; y: number; width: number; height: number; rotation: number },
): void {
  if ('resizeWithoutConstraints' in node)
    node.resizeWithoutConstraints(geometry.width, geometry.height);
  else if ('resize' in node) node.resize(geometry.width, geometry.height);
  node.x = geometry.x;
  node.y = geometry.y;
  if ('rotation' in node) node.rotation = geometry.rotation;
}

function applyContainerLayout(node: FrameNode, layout?: LayoutSpec, sizing?: SizingSpec): void {
  if (layout) {
    node.layoutMode = layout.mode;
    node.layoutWrap = 'NO_WRAP';
    node.itemSpacing = layout.gap;
    node.paddingTop = layout.padding.top;
    node.paddingRight = layout.padding.right;
    node.paddingBottom = layout.padding.bottom;
    node.paddingLeft = layout.padding.left;
    node.primaryAxisAlignItems = layout.primaryAxisAlign;
    node.counterAxisAlignItems = layout.counterAxisAlign;
  }
  applySizing(node, sizing);
}

function applyPlacement(node: SceneNode, placement?: DesignPlacement): void {
  if (!placement) return;
  if (placement.positioning && 'layoutPositioning' in node) {
    node.layoutPositioning = placement.positioning;
  }
  applySizing(node, placement.sizing);
}

function applySizing(node: SceneNode, sizing?: SizingSpec): void {
  if (!sizing || !('layoutSizingHorizontal' in node)) return;
  if (sizing.horizontal) node.layoutSizingHorizontal = sizing.horizontal;
  if (sizing.vertical) node.layoutSizingVertical = sizing.vertical;
}

function positionRoot(root: FrameNode, plan: DesignPlan, sources: SceneNode[]): void {
  if (sources.length === 0) {
    root.x = plan.proposal.offsetX;
    root.y = plan.proposal.offsetY;
    return;
  }
  const boxes = sources.map((node) => node.absoluteBoundingBox ?? node);
  root.x = Math.max(...boxes.map((box) => box.x + box.width)) + plan.proposal.offsetX;
  root.y = Math.min(...boxes.map((box) => box.y)) + plan.proposal.offsetY;
}

function invalid(message: string): BridgeFault {
  return new BridgeFault({ code: 'PLAN_INVALID', message, retryable: false });
}
