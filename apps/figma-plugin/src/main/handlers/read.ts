import {
  GetNodeInputSchema,
  GetFingerprintInputSchema,
  GetTreeRpcInputSchema,
  NodeResultSchema,
  type FingerprintRpcResult,
  type LightweightTreeNode,
  TreeRpcResultSchema,
  type TreeRpcResult,
} from '@figma-agent/protocol';

import { fingerprintNodeTree, serializeNode } from '../serialization/node-snapshot.js';
import { projectCompactNode } from '../serialization/compact-node.js';
import { serializeLightweightTreeNode } from '../serialization/lightweight-tree.js';
import { resolveCurrentPageNode, resolveCurrentPageReadNode } from '../serialization/resolve.js';
import { serializeGeometry } from '../serialization/node-summary.js';
import { isSceneNode } from '../serialization/resolve.js';

/** 内部先生成完整规范化快照，再按公开字段组返回紧凑投影。 */
export async function getNode(params: unknown) {
  const { nodeId, fields } = GetNodeInputSchema.parse(params);
  const node = await resolveCurrentPageReadNode(nodeId);
  if (node.type === 'PAGE') {
    return NodeResultSchema.parse({
      name: node.name,
      type: node.type,
      ...(node.parent ? { parentId: node.parent.id } : {}),
      ...(fields.includes('DIRECT_CHILDREN')
        ? {
            directChildren: node.children.filter(isSceneNode).map((child) => {
              const geometry = serializeGeometry(child);
              return {
                id: child.id,
                name: child.name,
                type: child.type,
                bounds: { inParent: geometry.local, onPage: geometry.absolute },
              };
            }),
          }
        : {}),
    });
  }
  const snapshot = await serializeNode(node);
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
  const root = await resolveCurrentPageReadNode(input.nodeId);
  let nodeCount = 0;
  let omittedChildCount = 0;
  const reasons = new Set<'DEPTH_LIMIT' | 'NODE_LIMIT'>();
  const frontierNodeIds = new Set<string>();

  const visit = (node: SceneNode | PageNode, depth: number, order: number): LightweightTreeNode => {
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
  const rootOrder = isSceneNode(root) ? Math.max(0, parentChildren.indexOf(root)) : 0;
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
