import {
  BridgeFault,
  PROPOSAL_PLUGIN_DATA_KEY,
  ProposalMarkerSchema,
  type ProposalMarker,
} from '@figma-agent/protocol';

import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

/** 将来源节点 ID 和创建时间写入 Proposal 根节点的 pluginData。 */
export function markProposal(root: SceneNode, sourceNodeIds: string[]): void {
  const marker: ProposalMarker = {
    version: 1,
    sourceNodeIds,
    createdAt: new Date().toISOString(),
  };
  root.setPluginData(PROPOSAL_PLUGIN_DATA_KEY, JSON.stringify(marker));
}

/** 读取并校验 Proposal 标记；历史脏数据按“不是 Proposal”处理。 */
export function readProposalMarker(node: SceneNode): ProposalMarker | undefined {
  const raw = node.getPluginData(PROPOSAL_PLUGIN_DATA_KEY);
  if (!raw) return undefined;
  try {
    const parsed = ProposalMarkerSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** 判断 node 是否位于 root 子树内，包含 root 自身。 */
export function isInside(root: SceneNode, node: SceneNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if (current.id === root.id) return true;
    current = current.parent;
  }
  return false;
}

/** 解析当前页上的 Proposal 根，并拒绝普通设计节点作为写入目标。 */
export async function resolveProposalRoot(proposalRootId: string): Promise<SceneNode> {
  const root = await resolveCurrentPageNode(proposalRootId);
  if (!readProposalMarker(root)) {
    throw new BridgeFault({
      code: 'NODE_NOT_IN_PROPOSAL',
      message: `Node ${proposalRootId} is not a bridge-created Proposal root.`,
      retryable: false,
      nodeId: proposalRootId,
    });
  }
  return root;
}

/**
 * 校验目标仍在 Proposal 内、未被用户锁定，并可选地匹配上一次观察到的指纹。
 */
export async function assertProposalTargets(
  proposalRootId: string,
  targetIds: string[],
  expectedFingerprint?: string,
): Promise<{ root: SceneNode; targets: SceneNode[] }> {
  const root = await resolveProposalRoot(proposalRootId);
  if (expectedFingerprint) {
    // 先校验整棵根树再解析目标，防止基于旧快照定位并修改节点。
    const actual = await fingerprintNodeTree([root]);
    if (actual !== expectedFingerprint) {
      throw new BridgeFault({
        code: 'PROPOSAL_CHANGED',
        message: 'The Proposal changed after it was inspected.',
        retryable: true,
        nodeId: proposalRootId,
        details: { expectedFingerprint, actualFingerprint: actual },
      });
    }
  }
  const targets = await Promise.all(targetIds.map(resolveCurrentPageNode));
  for (const target of targets) {
    if (!isInside(root, target)) {
      throw new BridgeFault({
        code: 'NODE_NOT_IN_PROPOSAL',
        message: `Node ${target.id} is outside Proposal ${root.id}.`,
        retryable: false,
        nodeId: target.id,
      });
    }
    if ('locked' in target && target.locked) {
      throw new BridgeFault({
        code: 'NODE_LOCKED',
        message: `Node ${target.id} is locked.`,
        retryable: true,
        nodeId: target.id,
      });
    }
  }
  return { root, targets };
}
