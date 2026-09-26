import {
  BridgeFault,
  DuplicateProposalInputSchema,
  type ProposalResult,
} from '@figma-agent/protocol';

import { mutationCoordinator } from '../mutation/coordinator.js';
import { mapClonedSubtree } from '../proposal/id-map.js';
import { isInside, markProposal } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

export async function duplicateAsProposal(params: unknown): Promise<ProposalResult> {
  const input = DuplicateProposalInputSchema.parse(params);
  return await mutationCoordinator.run(async () => {
    const sourceIds = input.nodeIds ?? figma.currentPage.selection.map((node) => node.id);
    if (sourceIds.length === 0) {
      throw new BridgeFault({
        code: 'NODE_NOT_FOUND',
        message: 'Select at least one node or provide nodeIds.',
        retryable: true,
      });
    }
    const sources = await Promise.all(sourceIds.map(resolveCurrentPageNode));
    assertNonOverlapping(sources);
    return sources.length === 1
      ? await duplicateSingle(sources[0]!, input.nameSuffix, input.offsetX, input.offsetY)
      : await duplicateMultiple(sources, input.nameSuffix, input.offsetX, input.offsetY);
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
    clone.visible = false;
    clone.name = `${source.name}${suffix}`;
    clone.x = source.x + source.width + offsetX;
    clone.y = source.y + offsetY;
    const idMap = mapClonedSubtree(source, clone);
    markProposal(clone, [source.id]);
    clone.visible = true;
    figma.currentPage.selection = [clone];
    figma.viewport.scrollAndZoomIntoView([clone]);
    figma.commitUndo();
    return {
      proposalRootId: clone.id,
      originalRootIds: [source.id],
      idMap,
      fingerprint: await fingerprintNodeTree([clone]),
    };
  } catch (error) {
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
    markProposal(wrapper, sources.map((source) => source.id));
    wrapper.visible = true;
    figma.currentPage.selection = [wrapper];
    figma.viewport.scrollAndZoomIntoView([wrapper]);
    figma.commitUndo();
    return {
      proposalRootId: wrapper.id,
      originalRootIds: sources.map((source) => source.id),
      idMap,
      fingerprint: await fingerprintNodeTree([wrapper]),
    };
  } catch (error) {
    wrapper.remove();
    throw error;
  }
}

function assertNonOverlapping(nodes: SceneNode[]): void {
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) {
    throw new BridgeFault({ code: 'INVALID_LAYOUT', message: 'Duplicate source node IDs.', retryable: false });
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

