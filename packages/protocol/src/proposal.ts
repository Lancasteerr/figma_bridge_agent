import { z } from 'zod';

export const PROPOSAL_PLUGIN_DATA_KEY = 'figma-agent-mcp:proposal';

export const ProposalMarkerSchema = z.object({
  version: z.literal(1),
  sourceNodeIds: z.array(z.string()).min(1),
  createdAt: z.string().datetime(),
});
export type ProposalMarker = z.infer<typeof ProposalMarkerSchema>;

export const ProposalResultSchema = z.object({
  proposalRootId: z.string(),
  originalRootIds: z.array(z.string()),
  idMap: z.record(z.string(), z.string()),
  fingerprint: z.string(),
});
export type ProposalResult = z.infer<typeof ProposalResultSchema>;

export const MutationResultSchema = z.object({
  proposalRootId: z.string(),
  affectedNodeIds: z.array(z.string()),
  fingerprint: z.string(),
});
export type MutationResult = z.infer<typeof MutationResultSchema>;

export const CreateComponentResultSchema = z.object({
  proposalRootId: z.string(),
  componentId: z.string(),
  replacedNodeId: z.string(),
  fingerprint: z.string(),
});
export type CreateComponentResult = z.infer<typeof CreateComponentResultSchema>;

export const DiscardProposalResultSchema = z.object({ discardedProposalRootId: z.string() });
