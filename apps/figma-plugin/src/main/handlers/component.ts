import {
  BridgeFault,
  CreateComponentInputSchema,
  type CreateComponentResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets, markProposal, readProposalMarker } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

export async function createComponentFromNode(params: unknown): Promise<CreateComponentResult> {
  const input = CreateComponentInputSchema.parse(params);
  return await atomicMutation(async () => {
    const { root, targets } = await assertProposalTargets(
      input.proposalRootId,
      [input.nodeId],
      input.expectedFingerprint,
    );
    const node = targets[0]!;
    if (node.type !== 'FRAME') {
      throw unsupported(node, 'Only a Frame can be converted to a Component in v1.');
    }
    assertNoComponentBoundary(node, root);
    const replacedNodeId = node.id;
    const replacesRoot = node.id === root.id;
    const marker = replacesRoot ? readProposalMarker(root) : undefined;
    const component = figma.createComponentFromNode(node);
    const proposalRoot = replacesRoot ? component : root;
    if (marker) markProposal(component, marker.sourceNodeIds);
    return {
      proposalRootId: proposalRoot.id,
      componentId: component.id,
      replacedNodeId,
      fingerprint: await fingerprintNodeTree([proposalRoot]),
    };
  });
}

function assertNoComponentBoundary(node: FrameNode, proposalRoot: SceneNode): void {
  let current = node.parent;
  while (current && current.id !== proposalRoot.id) {
    if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET' || current.type === 'INSTANCE') {
      throw unsupported(node, `Cannot create a Component inside ${current.type}.`);
    }
    current = current.parent;
  }
  if (node.findOne((child) => child.type === 'COMPONENT_SET')) {
    throw unsupported(node, 'A Frame containing a Component Set cannot be converted in v1.');
  }
}

function unsupported(node: SceneNode, message: string): BridgeFault {
  return new BridgeFault({
    code: 'UNSUPPORTED_NODE_TYPE',
    message,
    retryable: false,
    nodeId: node.id,
  });
}
