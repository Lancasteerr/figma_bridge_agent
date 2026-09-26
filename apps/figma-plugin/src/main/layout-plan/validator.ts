import { BridgeFault, type LayoutItem, type LayoutPlan } from '@figma-agent/protocol';

import { isInside } from '../proposal/marker.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

export interface ValidatedLayoutSource {
  roots: SceneNode[];
  referencedNodes: Map<string, SceneNode>;
}

export async function validateLayoutTopology(plan: LayoutPlan): Promise<ValidatedLayoutSource> {
  const roots = await Promise.all(plan.source.rootNodeIds.map(resolveCurrentPageNode));
  assertUnique(plan.source.rootNodeIds, 'source root');
  assertDisjointRoots(roots);

  const references = collectReferences(plan.root.children);
  assertUnique(references, 'layout item');
  const referencedNodes = new Map<string, SceneNode>();
  for (const id of references) {
    const node = await resolveCurrentPageNode(id);
    if (!roots.some((root) => isInside(root, node))) {
      throw invalid(`Referenced node ${id} is outside the declared source roots.`, id);
    }
    if (hasInstanceAncestorWithinRoots(node, roots)) {
      throw invalid(`Referenced node ${id} is inside an Instance and cannot be reparented.`, id);
    }
    referencedNodes.set(id, node);
  }
  assertNoAncestorPairs([...referencedNodes.values()]);
  assertFrameRefsUnique(plan.root.children);

  if (plan.root.kind === 'existing-container') {
    const root = await resolveCurrentPageNode(plan.root.sourceNodeId);
    if (!roots.some((candidate) => candidate.id === root.id)) {
      throw invalid('An existing-container root must be one of source.rootNodeIds.', root.id);
    }
    if (!supportsChildren(root) || root.type === 'INSTANCE') {
      throw invalid('The existing root must be a mutable container.', root.id);
    }
    assertCompleteCoverage(root, [...referencedNodes.values()]);
  } else {
    const referencedRootIds = new Set(
      [...referencedNodes.values()].filter((node) => roots.some((root) => root.id === node.id)).map((node) => node.id),
    );
    for (const root of roots) {
      if (!referencedRootIds.has(root.id)) {
        throw invalid(`Source root ${root.id} is omitted from the new-frame plan.`, root.id);
      }
    }
  }

  return { roots, referencedNodes };
}

function collectReferences(items: LayoutItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === 'existing' ? [item.sourceNodeId] : collectReferences(item.children),
  );
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw invalid(`Duplicate ${label} reference: ${value}.`, value);
    seen.add(value);
  }
}

function assertDisjointRoots(roots: SceneNode[]): void {
  for (const root of roots) {
    for (const other of roots) {
      if (root !== other && isInside(other, root)) {
        throw invalid('Source roots cannot contain both an ancestor and its descendant.', root.id);
      }
    }
  }
}

function assertNoAncestorPairs(nodes: SceneNode[]): void {
  for (const node of nodes) {
    for (const other of nodes) {
      if (node !== other && isInside(other, node)) {
        throw invalid('Layout items cannot reference both an ancestor and its descendant.', node.id);
      }
    }
  }
}

function assertFrameRefsUnique(items: LayoutItem[], seen = new Set<string>()): void {
  for (const item of items) {
    if (item.kind !== 'frame') continue;
    if (seen.has(item.ref)) throw invalid(`Duplicate frame ref: ${item.ref}.`);
    seen.add(item.ref);
    assertFrameRefsUnique(item.children, seen);
  }
}

function assertCompleteCoverage(container: SceneNode, referenced: SceneNode[]): void {
  if (!('children' in container)) return;
  for (const child of container.children) {
    if (!('x' in child)) continue;
    const covered = referenced.some((node) => node.id === child.id || isInside(child, node));
    if (!covered) throw invalid(`Existing container child ${child.id} is omitted.`, child.id);
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

function supportsChildren(node: SceneNode): node is ChildrenMixin & SceneNode {
  return 'appendChild' in node;
}

function invalid(message: string, nodeId?: string): BridgeFault {
  return new BridgeFault({ code: 'PLAN_INVALID', message, retryable: false, nodeId });
}
