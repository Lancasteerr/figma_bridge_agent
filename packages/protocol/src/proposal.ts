import { z } from 'zod';

/** Proposal 标记写入 Figma pluginData 时使用的稳定 key。 */
export const PROPOSAL_PLUGIN_DATA_KEY = 'figma-agent-mcp:proposal';

/** 标记记录 Proposal 的来源节点和创建时间，用于限制后续写操作范围。 */
export const ProposalMarkerSchema = z.object({
  version: z.literal(1),
  sourceNodeIds: z.array(z.string()).min(1),
  createdAt: z.string().datetime(),
});
/** Proposal pluginData 的结构化类型。 */
export type ProposalMarker = z.infer<typeof ProposalMarkerSchema>;

/** 克隆 Proposal 后返回源节点到副本节点的映射及初始指纹。 */
export const ProposalResultSchema = z.object({
  proposalRootId: z.string(),
  originalRootIds: z.array(z.string()),
  idMap: z.record(z.string(), z.string()),
  fingerprint: z.string(),
});
/** 创建 Proposal 的结果类型。 */
export type ProposalResult = z.infer<typeof ProposalResultSchema>;

/** Proposal 内部变更统一返回受影响节点和新的根指纹。 */
export const MutationResultSchema = z.object({
  proposalRootId: z.string(),
  affectedNodeIds: z.array(z.string()),
  fingerprint: z.string(),
});
/** Proposal 变更结果类型。 */
export type MutationResult = z.infer<typeof MutationResultSchema>;

/** Frame 转 Component 时，根节点可能被新 Component 替换，因此同时返回两个 ID。 */
export const CreateComponentResultSchema = z.object({
  proposalRootId: z.string(),
  componentId: z.string(),
  replacedNodeId: z.string(),
  fingerprint: z.string(),
});
/** Component 创建结果类型。 */
export type CreateComponentResult = z.infer<typeof CreateComponentResultSchema>;

/** 丢弃 Proposal 只返回被删除的根节点，调用方需先提供期望指纹。 */
export const DiscardProposalResultSchema = z.object({ discardedProposalRootId: z.string() });
