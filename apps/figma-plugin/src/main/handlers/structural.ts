import {
  BridgeFault,
  CreateFrameInputSchema,
  type MutationResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets } from '../proposal/marker.js';
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
