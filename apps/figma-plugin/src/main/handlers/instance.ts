import {
  BridgeFault,
  SetInstancePropertiesInputSchema,
  type MutationResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

export async function setInstanceProperties(params: unknown): Promise<MutationResult> {
  const input = SetInstancePropertiesInputSchema.parse(params);
  return await atomicMutation(async () => {
    const { root, targets } = await assertProposalTargets(
      input.proposalRootId,
      [input.nodeId],
      input.expectedFingerprint,
    );
    const node = targets[0]!;
    if (node.type !== 'INSTANCE') {
      throw new BridgeFault({
        code: 'UNSUPPORTED_NODE_TYPE',
        message: `Node ${node.id} is not an Instance.`,
        retryable: false,
        nodeId: node.id,
      });
    }
    try {
      node.setProperties(input.properties);
    } catch (error) {
      throw new BridgeFault({
        code: 'INVALID_LAYOUT',
        message: error instanceof Error ? error.message : 'Instance properties were rejected.',
        retryable: false,
        nodeId: node.id,
      });
    }
    return {
      proposalRootId: root.id,
      affectedNodeIds: [node.id],
      fingerprint: await fingerprintNodeTree([root]),
    };
  });
}
