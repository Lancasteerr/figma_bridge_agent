import {
  BridgeFault,
  DiscardProposalInputSchema,
  DuplicateProposalInputSchema,
  type ProposalResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { mapClonedSubtree } from '../proposal/id-map.js';
import { assertProposalTargets, markProposal } from '../proposal/marker.js';
import { resolveProposalScope, type ResolvedProposalScope } from '../proposal/scope.js';
import { sourceContextFingerprint } from '../proposal/source-context.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { isSceneNode, resolveCurrentPageNode } from '../serialization/resolve.js';

/** 将当前选区或显式节点复制到原稿旁的 Proposal，原始节点不直接修改。 */
export async function duplicateAsProposal(params: unknown): Promise<ProposalResult> {
  const input = DuplicateProposalInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const targetIds =
        input.editTargetNodeIds ?? figma.currentPage.selection.map((node) => node.id);
      if (targetIds.length === 0) {
        throw new BridgeFault({
          code: 'NODE_NOT_FOUND',
          message: 'Select at least one node or provide editTargetNodeIds.',
          retryable: true,
        });
      }
      const targets = await Promise.all(targetIds.map(resolveCurrentPageNode));
      const scope = resolveProposalScope(targets);
      const bounds = scope.roots.map(({ node }) => {
        const box = node.absoluteBoundingBox ?? node;
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
      return {
        scope,
        bounds,
        sourceFingerprint: await sourceContextFingerprint(scope.roots.map(({ node }) => node)),
      };
    },
    mutate: async ({ scope, bounds, sourceFingerprint }) =>
      await duplicateResolvedScope(
        scope,
        bounds,
        sourceFingerprint,
        input.nameSuffix,
        input.offsetX,
        input.offsetY,
      ),
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

async function duplicateResolvedScope(
  scope: ResolvedProposalScope,
  bounds: Array<{ x: number; y: number; width: number; height: number }>,
  expectedSourceFingerprint: string,
  suffix: string,
  offsetX: number,
  offsetY: number,
): Promise<ProposalResult> {
  const sources = scope.roots.map(({ node }) => node);
  const minX = Math.min(...bounds.map((box) => box.x));
  const minY = Math.min(...bounds.map((box) => box.y));
  const maxX = Math.max(...bounds.map((box) => box.x + box.width));
  const maxY = Math.max(...bounds.map((box) => box.y + box.height));
  const idMap: Record<string, string> = {};
  let root: SceneNode | undefined;
  try {
    if (sources.length === 1) {
      const source = sources[0]!;
      const clone = source.clone();
      root = clone;
      // clone() 会先在原父级生成节点；立即移到 Page，避免副本继续参与原布局。
      figma.currentPage.appendChild(clone);
      clone.visible = false;
      clone.name = `${source.name}${suffix}`;
      clone.x = maxX + offsetX;
      clone.y = minY + offsetY;
      mapClonedSubtree(source, clone, idMap);
    } else {
      const wrapper = figma.createFrame();
      root = wrapper;
      wrapper.visible = false;
      wrapper.name = `Selection${suffix}`;
      wrapper.fills = [];
      wrapper.clipsContent = false;
      wrapper.resizeWithoutConstraints(Math.max(1, maxX - minX), Math.max(1, maxY - minY));
      wrapper.x = maxX + offsetX;
      wrapper.y = minY + offsetY;

      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index]!;
        const sourceBounds = bounds[index]!;
        const clone = source.clone();
        // 与单根路径相同，克隆后第一时间脱离原父级。
        wrapper.appendChild(clone);
        mapClonedSubtree(source, clone, idMap);
        clone.x = sourceBounds.x - minX;
        clone.y = sourceBounds.y - minY;
      }
    }

    unlockSubtree(root);
    markProposal(
      root,
      sources.map((source) => source.id),
      scope.targets.map((target) => target.id),
    );

    const actualSourceFingerprint = await sourceContextFingerprint(sources);
    if (actualSourceFingerprint !== expectedSourceFingerprint) {
      throw new BridgeFault({
        code: 'SOURCE_CHANGED_DURING_CLONE',
        message: 'The source layout changed while the Proposal was being isolated.',
        retryable: true,
        details: {
          expectedFingerprint: expectedSourceFingerprint,
          actualFingerprint: actualSourceFingerprint,
        },
      });
    }

    const targetMap = scope.bindings.map((binding) => ({
      sourceNodeId: binding.target.id,
      proposalNodeId: requireMappedId(idMap, binding.target.id),
      cloneRootSourceNodeId: binding.root.id,
      resolution: binding.resolution,
    }));
    const cloneRoots = scope.roots.map(({ node, nodeCount }) => ({
      sourceNodeId: node.id,
      proposalNodeId: requireMappedId(idMap, node.id),
      nodeCount,
    }));

    root.visible = true;
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    return {
      proposalRootId: root.id,
      requestedTargetIds: scope.targets.map((target) => target.id),
      cloneRoots,
      targetMap,
      idMap,
      warnings: scope.warnings,
      fingerprint: await fingerprintNodeTree([root]),
    };
  } catch (error) {
    if (root && !root.removed) root.remove();
    throw error;
  }
}

function unlockSubtree(root: SceneNode): void {
  if ('locked' in root) root.locked = false;
  if ('children' in root) {
    for (const child of root.children.filter(isSceneNode)) unlockSubtree(child);
  }
}

function requireMappedId(idMap: Record<string, string>, sourceNodeId: string): string {
  const mapped = idMap[sourceNodeId];
  if (!mapped) {
    throw new BridgeFault({
      code: 'INTERNAL_ERROR',
      message: `Clone mapping for ${sourceNodeId} is unavailable.`,
      retryable: false,
      nodeId: sourceNodeId,
    });
  }
  return mapped;
}
