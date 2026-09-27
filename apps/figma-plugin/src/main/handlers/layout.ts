import { BridgeFault, SetLayoutInputSchema, type MutationResult } from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

/** 在 Proposal 节点上写入 v1 支持的 Auto Layout、尺寸和定位字段。 */
export async function setLayout(params: unknown): Promise<MutationResult> {
  const input = SetLayoutInputSchema.parse(params);
  return await atomicMutation(async () => {
    const { root, targets } = await assertProposalTargets(
      input.proposalRootId,
      [input.nodeId],
      input.expectedFingerprint,
    );
    const node = targets[0]!;
    validateLayoutInput(node, input);

    if (input.layout && hasWritableAutoLayout(node)) {
      node.layoutMode = input.layout.mode;
      node.itemSpacing = input.layout.gap;
      node.paddingTop = input.layout.padding.top;
      node.paddingRight = input.layout.padding.right;
      node.paddingBottom = input.layout.padding.bottom;
      node.paddingLeft = input.layout.padding.left;
      node.primaryAxisAlignItems = input.layout.primaryAxisAlign;
      node.counterAxisAlignItems = input.layout.counterAxisAlign;
      node.layoutWrap = 'NO_WRAP';
    }
    if (input.sizing && 'layoutSizingHorizontal' in node) {
      if (input.sizing.horizontal) node.layoutSizingHorizontal = input.sizing.horizontal;
      if (input.sizing.vertical) node.layoutSizingVertical = input.sizing.vertical;
    }
    if (input.positioning && 'layoutPositioning' in node)
      node.layoutPositioning = input.positioning;
    if (input.absolute) {
      node.x = input.absolute.x;
      node.y = input.absolute.y;
    }
    return {
      proposalRootId: root.id,
      affectedNodeIds: [node.id],
      fingerprint: await fingerprintNodeTree([root]),
    };
  });
}

type SetLayoutInput = ReturnType<typeof SetLayoutInputSchema.parse>;

/** 在触碰 Figma 属性前校验节点能力和 FILL/HUG/ABSOLUTE 的父子约束。 */
function validateLayoutInput(node: SceneNode, input: SetLayoutInput): void {
  if (input.layout && !hasWritableAutoLayout(node)) {
    throw invalid(
      node,
      'Only Frame, Component, and Component Set nodes support v1 Auto Layout writes.',
    );
  }
  if (input.sizing && !('layoutSizingHorizontal' in node)) {
    throw invalid(node, 'This node does not support layout sizing.');
  }
  const parentAutoLayout =
    node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE';
  if (input.sizing?.horizontal === 'FILL' || input.sizing?.vertical === 'FILL') {
    if (!parentAutoLayout) throw invalid(node, 'FILL requires an Auto Layout parent.');
  }
  if (input.sizing?.horizontal === 'HUG' || input.sizing?.vertical === 'HUG') {
    const ownAutoLayout = hasWritableAutoLayout(node) && node.layoutMode !== 'NONE';
    if (!ownAutoLayout && node.type !== 'TEXT') {
      throw invalid(node, 'HUG requires a Text node or an Auto Layout container.');
    }
  }
  if (input.positioning) {
    if (!parentAutoLayout || !('layoutPositioning' in node)) {
      throw invalid(node, 'layoutPositioning requires a direct Auto Layout parent.');
    }
  }
  const currentlyAbsolute = 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE';
  if (input.absolute && input.positioning !== 'ABSOLUTE' && !currentlyAbsolute) {
    throw invalid(node, 'Absolute coordinates require ABSOLUTE positioning.');
  }
}

function hasWritableAutoLayout(
  node: SceneNode,
): node is FrameNode | ComponentNode | ComponentSetNode {
  return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
}

function invalid(node: SceneNode, message: string): BridgeFault {
  return new BridgeFault({
    code: 'INVALID_LAYOUT',
    message,
    retryable: false,
    nodeId: node.id,
  });
}
