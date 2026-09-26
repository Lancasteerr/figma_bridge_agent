import { BridgeFault, UpdateTextInputSchema, type MutationResult } from '@figma-agent/protocol';

import { atomicMutation } from '../mutation/coordinator.js';
import { assertProposalTargets } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';

export async function updateText(params: unknown): Promise<MutationResult> {
  const input = UpdateTextInputSchema.parse(params);
  const { root, targets } = await assertProposalTargets(
    input.proposalRootId,
    [input.nodeId],
    input.expectedFingerprint,
  );
  const node = targets[0]!;
  if (node.type !== 'TEXT') {
    throw new BridgeFault({
      code: 'UNSUPPORTED_NODE_TYPE',
      message: `Node ${node.id} is not a Text node.`,
      retryable: false,
      nodeId: node.id,
    });
  }
  await preflightFonts(node, input.fontName);

  return await atomicMutation(async () => {
    if (input.fontName) node.fontName = input.fontName;
    if (input.characters !== undefined) node.characters = input.characters;
    if (input.fontSize !== undefined) node.fontSize = input.fontSize;
    if (input.lineHeight !== undefined) {
      node.lineHeight = { value: input.lineHeight, unit: 'PIXELS' };
    }
    return {
      proposalRootId: root.id,
      affectedNodeIds: [node.id],
      fingerprint: await fingerprintNodeTree([root]),
    };
  });
}

async function preflightFonts(node: TextNode, requested?: FontName): Promise<void> {
  if (node.hasMissingFont) {
    throw missing(node, 'The Text node contains a missing font.');
  }
  const fonts = requested
    ? [requested]
    : node.characters.length > 0
      ? node.getRangeAllFontNames(0, node.characters.length)
      : node.fontName === figma.mixed
        ? []
        : [node.fontName];
  const unique = new Map(fonts.map((font) => [`${font.family}\u0000${font.style}`, font]));
  try {
    await Promise.all([...unique.values()].map((font) => figma.loadFontAsync(font)));
  } catch (error) {
    throw missing(
      node,
      error instanceof Error ? error.message : 'A required font could not be loaded.',
    );
  }
}

function missing(node: TextNode, message: string): BridgeFault {
  return new BridgeFault({
    code: 'MISSING_FONT',
    message,
    retryable: true,
    nodeId: node.id,
  });
}
