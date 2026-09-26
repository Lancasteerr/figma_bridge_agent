import { CssResultSchema, GetCssInputSchema } from '@figma-agent/protocol';

import { resolveCurrentPageNode } from '../serialization/resolve.js';

export async function getCss(params: unknown): Promise<ReturnType<typeof CssResultSchema.parse>> {
  const { nodeId } = GetCssInputSchema.parse(params);
  const node = await resolveCurrentPageNode(nodeId);
  return CssResultSchema.parse({
    nodeId: node.id,
    hintOnly: true,
    properties: await node.getCSSAsync(),
  });
}
