import {
  GetNodeInputSchema,
  GetFingerprintInputSchema,
  GetTreeRpcInputSchema,
  type FingerprintRpcResult,
  type LightweightTreeNode,
  TreeRpcResultSchema,
  type TreeRpcResult,
} from '@figma-agent/protocol';

import { fingerprintNodeTree, serializeNode } from '../serialization/node-snapshot.js';
import { projectCompactNode } from '../serialization/compact-node.js';
import { serializeLightweightTreeNode } from '../serialization/lightweight-tree.js';
import { isSceneNode, resolveCurrentPageNode } from '../serialization/resolve.js';

const MAX_PAGE_FRONTIER_IDS = 100;

/** 内部先生成完整规范化快照，再按公开字段组返回紧凑投影。 */
export async function getNode(params: unknown) {
  const { nodeId, fields } = GetNodeInputSchema.parse(params);
  const snapshot = await serializeNode(await resolveCurrentPageNode(nodeId));
  return projectCompactNode(snapshot, fields);
}

/** 返回与 DesignPlan 和 Proposal 乐观并发校验完全相同的完整树聚合指纹。 */
export async function getFingerprint(params: unknown): Promise<FingerprintRpcResult> {
  const { nodeIds } = GetFingerprintInputSchema.parse(params);
  const nodes = await Promise.all(nodeIds.map(resolveCurrentPageNode));
  return { nodeIds, fingerprint: await fingerprintNodeTree(nodes) };
}

/** 按深度和节点数上限读取轻量导航树，并独立报告真实遍历截断。 */
export async function getTree(params: unknown): Promise<TreeRpcResult> {
  const input = GetTreeRpcInputSchema.parse(params);
  if ('scope' in input) {
    return getCurrentPageTree(figma.currentPage, input);
  }
  const root = await resolveCurrentPageNode(input.nodeId);
  let nodeCount = 0;
  let omittedChildCount = 0;
  const reasons = new Set<'DEPTH_LIMIT' | 'NODE_LIMIT'>();
  const frontierNodeIds = new Set<string>();

  const visit = (node: SceneNode, depth: number, order: number): LightweightTreeNode => {
    nodeCount += 1;
    const childNodes = 'children' in node ? node.children.filter(isSceneNode) : [];
    const children: LightweightTreeNode[] = [];
    if (depth === 0 && childNodes.length > 0) {
      reasons.add('DEPTH_LIMIT');
      frontierNodeIds.add(node.id);
      omittedChildCount += childNodes.length;
    } else {
      for (const [childOrder, child] of childNodes.entries()) {
        if (nodeCount < input.maxNodes) {
          children.push(visit(child, depth - 1, childOrder));
          continue;
        }
        reasons.add('NODE_LIMIT');
        frontierNodeIds.add(child.id);
        omittedChildCount += 1;
      }
    }
    return {
      ...serializeLightweightTreeNode(node, order, input.maxTextLength),
      children,
    };
  };

  const parentChildren =
    root.parent && 'children' in root.parent
      ? root.parent.children.filter(isSceneNode)
      : ([] as SceneNode[]);
  const rootOrder = Math.max(0, parentChildren.indexOf(root));
  const tree = visit(root, input.depth, rootOrder);
  const truncation =
    reasons.size > 0
      ? {
          reasons: [...reasons],
          frontierNodeIds: [...frontierNodeIds],
          omittedChildCount,
        }
      : undefined;
  return TreeRpcResultSchema.parse({
    schemaVersion: 2,
    scope: {
      rootNodeId: root.id,
      requestedDepth: input.depth,
      maxNodes: input.maxNodes,
    },
    coverage: {
      complete: reasons.size === 0,
      nodeCount,
      ...(truncation ? { truncation } : {}),
    },
    root: tree,
  });
}

/** 先给页面直属图层分配节点预算，再逐层展开其子图层。 */
function getCurrentPageTree(
  page: PageNode,
  input: { depth: number; maxNodes: number; maxTextLength: number },
): TreeRpcResult {
  const pageChildren = page.children;
  const root = {
    id: page.id,
    name: page.name.slice(0, 200),
    type: 'PAGE' as const,
    childCount: pageChildren.length,
    children: [] as LightweightTreeNode[],
  };
  const queue: Array<{
    source: PageNode | SceneNode;
    target: Pick<LightweightTreeNode, 'children'>;
    depth: number;
  }> = [{ source: page, target: root, depth: 0 }];
  const reasons = new Set<'DEPTH_LIMIT' | 'NODE_LIMIT'>();
  const frontierNodeIds = new Set<string>();
  let frontierNodeIdsTruncated = false;
  let omittedChildCount = 0;

  // 截断仍保留精确计数，只限制随结果返回的边界 ID。
  const addFrontier = (id: string) => {
    if (frontierNodeIds.has(id)) return;
    if (frontierNodeIds.size < MAX_PAGE_FRONTIER_IDS) {
      frontierNodeIds.add(id);
    } else {
      frontierNodeIdsTruncated = true;
    }
  };

  for (const { source, target, depth } of queue) {
    const children =
      source.type === 'PAGE' ? pageChildren : 'children' in source ? source.children : [];
    if (children.length === 0) continue;
    if (depth === input.depth) {
      reasons.add('DEPTH_LIMIT');
      omittedChildCount += children.length;
      addFrontier(source.id);
      continue;
    }

    const includedCount = Math.min(children.length, input.maxNodes - queue.length);
    for (let order = 0; order < includedCount; order += 1) {
      const child = children[order]!;
      const node = {
        ...serializeLightweightTreeNode(child, order, input.maxTextLength),
        children: [],
      };
      target.children.push(node);
      queue.push({ source: child, target: node, depth: depth + 1 });
    }
    if (includedCount < children.length) {
      reasons.add('NODE_LIMIT');
      omittedChildCount += children.length - includedCount;
      for (
        let order = includedCount;
        order < children.length && !frontierNodeIdsTruncated;
        order += 1
      ) {
        addFrontier(children[order]!.id);
      }
    }
  }

  return TreeRpcResultSchema.parse({
    schemaVersion: 3,
    scope: { rootNodeId: page.id, requestedDepth: input.depth, maxNodes: input.maxNodes },
    coverage: {
      complete: reasons.size === 0,
      nodeCount: queue.length,
      ...(reasons.size > 0
        ? {
            truncation: {
              reasons: [...reasons],
              frontierNodeIds: [...frontierNodeIds],
              omittedChildCount,
              ...(frontierNodeIdsTruncated ? { frontierNodeIdsTruncated: true } : {}),
            },
          }
        : {}),
    },
    root,
  });
}
