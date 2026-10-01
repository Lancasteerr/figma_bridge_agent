import {
  BridgeFault,
  CreateComponentInputSchema,
  type CreateComponentResult,
} from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets, markProposal, readProposalMarker } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

/** 将 Proposal 内的 Frame 转为 Component，并在根节点被替换时重新写入 Proposal 标记。 */
export async function createComponentFromNode(params: unknown): Promise<CreateComponentResult> {
  const input = CreateComponentInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
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
      return {
        root,
        node,
        replacedNodeId: node.id,
        replacesRoot: node.id === root.id,
        marker: node.id === root.id ? readProposalMarker(root) : undefined,
      };
    },
    mutate: async ({ root, node, replacedNodeId, replacesRoot, marker }) => {
      const component = figma.createComponentFromNode(node);
      // createComponentFromNode 会替换原 Frame，因此根 Proposal 的 marker 不能依赖旧节点。
      const proposalRoot = replacesRoot ? component : root;
      if (marker) markProposal(component, marker.sourceRootIds, marker.requestedTargetIds);
      return {
        proposalRootId: proposalRoot.id,
        componentId: component.id,
        replacedNodeId,
        fingerprint: await fingerprintNodeTree([proposalRoot]),
      };
    },
  });
}

function assertNoComponentBoundary(node: FrameNode, proposalRoot: SceneNode): void {
  // Component/Instance 边界会改变可编辑范围，v1 不允许跨边界转换。
  let current = node.parent;
  while (current && current.id !== proposalRoot.id) {
    if (
      current.type === 'COMPONENT' ||
      current.type === 'COMPONENT_SET' ||
      current.type === 'INSTANCE'
    ) {
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
