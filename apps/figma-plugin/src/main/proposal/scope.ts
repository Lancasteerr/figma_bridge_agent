import { BridgeFault, type CloneScopeResolution } from '@figma-agent/protocol';

const MAX_CLONE_SCOPE_NODES = 1_000;
const CONTEXT_CONTAINER_TYPES = new Set([
  'FRAME',
  'COMPONENT',
  'GROUP',
  'BOOLEAN_OPERATION',
  'SLOT',
  'TRANSFORM_GROUP',
]);
const INDEPENDENT_CONTAINER_TYPES = new Set([
  ...CONTEXT_CONTAINER_TYPES,
  'COMPONENT_SET',
  'INSTANCE',
  'SECTION',
]);

export interface ScopeWarning {
  code: string;
  message: string;
  nodeId?: string;
}

export interface ResolvedCloneRoot {
  node: SceneNode;
  nodeCount: number;
}

export interface ResolvedTargetBinding {
  target: SceneNode;
  root: SceneNode;
  resolution: CloneScopeResolution;
}

export interface ResolvedProposalScope {
  targets: SceneNode[];
  roots: ResolvedCloneRoot[];
  bindings: ResolvedTargetBinding[];
  warnings: ScopeWarning[];
}

interface CandidateBinding {
  target: SceneNode;
  root: SceneNode;
  resolution: CloneScopeResolution;
}

/**
 * 根据 Agent 指定的编辑目标推导最小但足够的布局上下文。
 * requested target 只参与范围推导；最终整个 Proposal 根仍然可写。
 */
export function resolveProposalScope(targets: SceneNode[]): ResolvedProposalScope {
  assertUniqueTargets(targets);
  const warnings: ScopeWarning[] = [];
  const candidates = targets.map((target) => resolveCandidate(target, warnings));
  const uniqueRoots = uniqueById(candidates.map((binding) => binding.root));
  const roots = uniqueRoots.filter(
    (root) => !uniqueRoots.some((other) => other.id !== root.id && isInside(other, root)),
  );
  const resolvedRoots = roots.map((node) => ({ node, nodeCount: countSceneNodes(node) }));
  const total = resolvedRoots.reduce((sum, root) => sum + root.nodeCount, 0);
  if (total > MAX_CLONE_SCOPE_NODES) {
    throw new BridgeFault({
      code: 'LIMIT_EXCEEDED',
      message: `Resolved clone scope contains ${total} nodes; the limit is ${MAX_CLONE_SCOPE_NODES}.`,
      retryable: true,
      details: {
        nodeCount: total,
        limit: MAX_CLONE_SCOPE_NODES,
        cloneRootIds: roots.map((root) => root.id),
      },
    });
  }

  const rootUseCounts = new Map<string, number>();
  const rootForTarget = new Map<string, SceneNode>();
  for (const target of targets) {
    const root = roots.find((candidate) => isInside(candidate, target));
    if (!root) throw invalid(target, 'No clone root contains the requested target.');
    rootForTarget.set(target.id, root);
    rootUseCounts.set(root.id, (rootUseCounts.get(root.id) ?? 0) + 1);
  }

  const bindings = candidates.map((candidate) => {
    const root = rootForTarget.get(candidate.target.id)!;
    const shared = root.id !== candidate.root.id || (rootUseCounts.get(root.id) ?? 0) > 1;
    return {
      target: candidate.target,
      root,
      resolution:
        candidate.resolution === 'LIMIT_FALLBACK'
          ? candidate.resolution
          : shared
            ? 'SHARED_CONTEXT'
            : candidate.resolution,
    } satisfies ResolvedTargetBinding;
  });

  return { targets, roots: resolvedRoots, bindings, warnings };
}

function resolveCandidate(target: SceneNode, warnings: ScopeWarning[]): CandidateBinding {
  assertNotInsideInstance(target);
  const candidate = chooseCandidate(target);
  const candidateCount = countSceneNodes(candidate.root);
  if (candidateCount <= MAX_CLONE_SCOPE_NODES) return candidate;

  const targetCount = countSceneNodes(target);
  if (targetCount > MAX_CLONE_SCOPE_NODES) {
    throw new BridgeFault({
      code: 'LIMIT_EXCEEDED',
      message: `Requested target ${target.id} contains ${targetCount} nodes; the limit is ${MAX_CLONE_SCOPE_NODES}.`,
      retryable: true,
      nodeId: target.id,
      details: { nodeCount: targetCount, limit: MAX_CLONE_SCOPE_NODES },
    });
  }

  warnings.push({
    code: 'CLONE_CONTEXT_TRUNCATED',
    message: `The resolved context for ${target.id} contains ${candidateCount} nodes, so the Proposal will clone only the requested target.`,
    nodeId: target.id,
  });
  return { target, root: target, resolution: 'LIMIT_FALLBACK' };
}

function chooseCandidate(target: SceneNode): CandidateBinding {
  const parent = sceneParent(target);
  if (!parent || parent.type === 'SECTION') {
    return { target, root: target, resolution: 'TARGET' };
  }

  const parentUsesAutoLayout =
    parent.type !== 'COMPONENT_SET' && 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  const targetIsAbsolute = 'layoutPositioning' in target && target.layoutPositioning === 'ABSOLUTE';
  if (parentUsesAutoLayout && !targetIsAbsolute) {
    return { target, root: parent, resolution: 'AUTO_LAYOUT_PARENT' };
  }

  if (INDEPENDENT_CONTAINER_TYPES.has(target.type)) {
    return { target, root: target, resolution: 'TARGET' };
  }

  let current: BaseNode | null = target.parent;
  while (current && current.type !== 'PAGE' && current.type !== 'SECTION') {
    if (current.type === 'INSTANCE') break;
    if (isScene(current) && CONTEXT_CONTAINER_TYPES.has(current.type)) {
      return { target, root: current, resolution: 'NEAREST_CONTAINER' };
    }
    current = current.parent;
  }
  return { target, root: target, resolution: 'TARGET' };
}

function assertUniqueTargets(targets: SceneNode[]): void {
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target.id)) {
      throw invalid(target, `Duplicate edit target node ID: ${target.id}.`);
    }
    seen.add(target.id);
  }
}

function assertNotInsideInstance(target: SceneNode): void {
  let current = target.parent;
  while (current && current.type !== 'PAGE') {
    if (current.type === 'INSTANCE') {
      throw new BridgeFault({
        code: 'NODE_INSIDE_INSTANCE',
        message: `Node ${target.id} is inside Instance ${current.id}; target the Instance instead.`,
        retryable: false,
        nodeId: target.id,
      });
    }
    current = current.parent;
  }
}

function countSceneNodes(root: SceneNode): number {
  if (!('children' in root)) return 1;
  return (
    1 + root.children.filter(isScene).reduce((total, child) => total + countSceneNodes(child), 0)
  );
}

function sceneParent(node: SceneNode): SceneNode | undefined {
  return node.parent && isScene(node.parent) ? node.parent : undefined;
}

function uniqueById(nodes: SceneNode[]): SceneNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function isInside(root: SceneNode, node: SceneNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if (current.id === root.id) return true;
    current = current.parent;
  }
  return false;
}

function isScene(node: BaseNode): node is SceneNode {
  return node.type !== 'DOCUMENT' && node.type !== 'PAGE' && 'x' in node && 'width' in node;
}

function invalid(node: SceneNode, message: string): BridgeFault {
  return new BridgeFault({
    code: 'INVALID_LAYOUT',
    message,
    retryable: false,
    nodeId: node.id,
  });
}
