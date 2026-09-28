import {
  BridgeFault,
  DiscardProposalInputSchema,
  DuplicateProposalInputSchema,
  type ProposalResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { mapClonedSubtree } from '../proposal/id-map.js';
import { assertProposalTargets, isInside, markProposal } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

/** 将当前选区或显式节点复制到原稿旁的 Proposal，原始节点不直接修改。 */
export async function duplicateAsProposal(params: unknown): Promise<ProposalResult> {
  const input = DuplicateProposalInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const sourceIds = input.nodeIds ?? figma.currentPage.selection.map((node) => node.id);
      if (sourceIds.length === 0) {
        throw new BridgeFault({
          code: 'NODE_NOT_FOUND',
          message: 'Select at least one node or provide nodeIds.',
          retryable: true,
        });
      }
      const sources = await Promise.all(sourceIds.map(resolveCurrentPageNode));
      // 祖先和后代同时复制会产生歧义的相对层级，因此在克隆前拒绝重叠来源。
      assertNonOverlapping(sources);
      return sources;
    },
    mutate: async (sources) =>
      sources.length === 1
        ? await duplicateSingle(sources[0]!, input.nameSuffix, input.offsetX, input.offsetY)
        : await duplicateMultiple(sources, input.nameSuffix, input.offsetX, input.offsetY),
  });
}

/** 在指纹仍匹配时删除由桥接创建的 Proposal。 */
export async function discardProposal(
  params: unknown,
): Promise<{ discardedProposalRootId: string }> {
  const input = DiscardProposalInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const { root } = await assertProposalTargets(
        input.proposalRootId,
        [input.proposalRootId],
        input.expectedFingerprint,
      );
      return root;
    },
    mutate: (root) => {
      const id = root.id;
      root.remove();
      return { discardedProposalRootId: id };
    },
  });
}

async function duplicateSingle(
  source: SceneNode,
  suffix: string,
  offsetX: number,
  offsetY: number,
): Promise<ProposalResult> {
  const clone = source.clone();
  try {
    // 先隐藏并完成定位，避免用户看到尚未标记和布局完成的中间状态。
    clone.visible = false;
    clone.name = `${source.name}${suffix}`;
    clone.x = source.x + source.width + offsetX;
    clone.y = source.y + offsetY;
    const idMap = mapClonedSubtree(source, clone);
    markProposal(clone, [source.id]);
    clone.visible = true;
    figma.currentPage.selection = [clone];
    figma.viewport.scrollAndZoomIntoView([clone]);
    return {
      proposalRootId: clone.id,
      originalRootIds: [source.id],
      idMap,
      fingerprint: await fingerprintNodeTree([clone]),
    };
  } catch (error) {
    // clone 已经进入文档，后续任何一步失败都必须主动删除它。
    clone.remove();
    throw error;
  }
}

async function duplicateMultiple(
  sources: SceneNode[],
  suffix: string,
  offsetX: number,
  offsetY: number,
): Promise<ProposalResult> {
  const bounds = sources.map((node) => node.absoluteBoundingBox ?? node);
  const minX = Math.min(...bounds.map((box) => box.x));
  const minY = Math.min(...bounds.map((box) => box.y));
  const maxX = Math.max(...bounds.map((box) => box.x + box.width));
  const maxY = Math.max(...bounds.map((box) => box.y + box.height));
  const wrapper = figma.createFrame();
  try {
    wrapper.visible = false;
    wrapper.name = `Selection${suffix}`;
    wrapper.fills = [];
    wrapper.clipsContent = false;
    wrapper.resizeWithoutConstraints(Math.max(1, maxX - minX), Math.max(1, maxY - minY));
    wrapper.x = maxX + offsetX;
    wrapper.y = minY + offsetY;

    const idMap: Record<string, string> = {};
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]!;
      const sourceBounds = bounds[index]!;
      const clone = source.clone();
      mapClonedSubtree(source, clone, idMap);
      wrapper.appendChild(clone);
      clone.x = sourceBounds.x - minX;
      clone.y = sourceBounds.y - minY;
    }
    markProposal(
      wrapper,
      sources.map((source) => source.id),
    );
    wrapper.visible = true;
    figma.currentPage.selection = [wrapper];
    figma.viewport.scrollAndZoomIntoView([wrapper]);
    return {
      proposalRootId: wrapper.id,
      originalRootIds: sources.map((source) => source.id),
      idMap,
      fingerprint: await fingerprintNodeTree([wrapper]),
    };
  } catch (error) {
    // 多选复制使用 wrapper 作为唯一回滚根，避免留下部分克隆。
    wrapper.remove();
    throw error;
  }
}

function assertNonOverlapping(nodes: SceneNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) {
    throw new BridgeFault({
      code: 'INVALID_LAYOUT',
      message: 'Duplicate source node IDs.',
      retryable: false,
    });
  }
  for (const node of nodes) {
    for (const candidate of nodes) {
      if (node !== candidate && isInside(candidate, node)) {
        throw new BridgeFault({
          code: 'INVALID_LAYOUT',
          message: 'A source selection cannot include both an ancestor and its descendant.',
          retryable: false,
          nodeId: node.id,
        });
      }
    }
  }
}
