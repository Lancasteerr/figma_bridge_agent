import {
  BridgeFault,
  DESIGN_PLAN_MAX_DEPTH,
  DESIGN_PLAN_MAX_NODES,
  type DesignNode,
  type DesignPlan,
} from '@figma-agent/protocol';

import { isInside } from '../proposal/marker.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

export interface ValidatedDesignSource {
  roots: SceneNode[];
  cloneSources: Map<string, SceneNode>;
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

    if (node.kind === 'FRAME') {
      for (const child of node.children) await visit(child, depth + 1);
    }
  };

  await visit(plan.root, 1);
  return { roots, cloneSources };
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
