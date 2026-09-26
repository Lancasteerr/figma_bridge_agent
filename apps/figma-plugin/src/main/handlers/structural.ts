import {
  BridgeFault,
  CreateFrameInputSchema,
  ReparentNodesInputSchema,
  type MutationResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets, isInside } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

export async function createFrame(params: unknown): Promise<MutationResult> {
  const input = CreateFrameInputSchema.parse(params);
  return await atomicMutation(async () => {
    const { root, targets } = await assertProposalTargets(
      input.proposalRootId,
      [input.parentId],
      input.expectedFingerprint,
    );
    const parent = targets[0]!;
    if (!('appendChild' in parent) || parent.type === 'INSTANCE') {
      throw new BridgeFault({
        code: 'UNSUPPORTED_NODE_TYPE',
        message: `Node ${parent.id} cannot contain a new Frame.`,
        retryable: false,
        nodeId: parent.id,
      });
    }
    const frame = figma.createFrame();
    frame.name = input.name;
    frame.resizeWithoutConstraints(input.width, input.height);
    const index = Math.min(input.index ?? parent.children.length, parent.children.length);
    parent.insertChild(index, frame);
    frame.x = input.x;
    frame.y = input.y;
    return {
      proposalRootId: root.id,
      affectedNodeIds: [frame.id],
      fingerprint: await fingerprintNodeTree([root]),
    };
  });
}

export async function reparentNodes(params: unknown): Promise<MutationResult> {
  const input = ReparentNodesInputSchema.parse(params);
  return await atomicMutation(async () => {
    const { root, targets } = await assertProposalTargets(
      input.proposalRootId,
      [...input.nodeIds, input.parentId],
      input.expectedFingerprint,
    );
    const parent = targets.at(-1)!;
    const nodes = targets.slice(0, -1);
    if (!('insertChild' in parent) || parent.type === 'INSTANCE') {
      throw new BridgeFault({
        code: 'UNSUPPORTED_NODE_TYPE',
        message: `Node ${parent.id} cannot receive children.`,
        retryable: false,
        nodeId: parent.id,
      });
    }
    for (const node of nodes) {
      if (node.id === root.id || isInside(node, parent)) {
        throw new BridgeFault({
          code: 'INVALID_LAYOUT',
          message: `Reparenting ${node.id} would create a cycle or move the Proposal root.`,
          retryable: false,
          nodeId: node.id,
        });
      }
      assertNotInsideInstance(root, node);
    }

    const origins = nodes.map((node) => ({
      x: node.absoluteTransform[0][2],
      y: node.absoluteTransform[1][2],
    }));
    const autoLayoutParent = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
    const index = Math.min(input.index ?? parent.children.length, parent.children.length);
    for (let offset = 0; offset < nodes.length; offset += 1) {
      const node = nodes[offset]!;
      parent.insertChild(Math.min(index + offset, parent.children.length), node);
      if (autoLayoutParent && 'layoutPositioning' in node) {
        node.layoutPositioning = input.placement === 'ABSOLUTE' ? 'ABSOLUTE' : 'AUTO';
      }
      if (input.preserveAbsolutePosition && (!autoLayoutParent || input.placement === 'ABSOLUTE')) {
        const local = toLocalPoint(parent.absoluteTransform, origins[offset]!);
        node.x = local.x;
        node.y = local.y;
      }
    }
    return {
      proposalRootId: root.id,
      affectedNodeIds: nodes.map((node) => node.id),
      fingerprint: await fingerprintNodeTree([root]),
    };
  });
}

function assertNotInsideInstance(root: SceneNode, node: SceneNode): void {
  let current = node.parent;
  while (current && current.id !== root.id) {
    if (current.type === 'INSTANCE') {
      throw new BridgeFault({
        code: 'NODE_INSIDE_INSTANCE',
        message: `Node ${node.id} is inside Instance ${current.id}.`,
        retryable: false,
        nodeId: node.id,
      });
    }
    current = current.parent;
  }
}

function toLocalPoint(
  transform: Transform,
  point: { x: number; y: number },
): { x: number; y: number } {
  const [[a, c, e], [b, d, f]] = transform;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-8) return { x: point.x - e, y: point.y - f };
  const dx = point.x - e;
  const dy = point.y - f;
  return {
    x: (d * dx - c * dy) / determinant,
    y: (-b * dx + a * dy) / determinant,
  };
}
