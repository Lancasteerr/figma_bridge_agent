import { z } from 'zod';

/** Proposal 标记写入 Figma pluginData 时使用的稳定 key。 */
export const PROPOSAL_PLUGIN_DATA_KEY = 'figma-agent-mcp:proposal';

/** v2 保持只读兼容，已有 Proposal 无需迁移即可继续编辑。 */
export const ProposalMarkerV2Schema = z.object({
  version: z.literal(2),
  sourceRootIds: z.array(z.string()).min(1),
  requestedTargetIds: z.array(z.string()).min(1),
  createdAt: z.string().datetime(),
});

/** v3 可以表达完全由 Agent 生成、没有源节点的 Proposal。 */
export const ProposalMarkerV3Schema = z.object({
  version: z.literal(3),
  origin: z.enum(['CLONED', 'GENERATED']),
  sourceRootIds: z.array(z.string()),
  requestedTargetIds: z.array(z.string()),
  state: z.enum(['BUILDING', 'COMMITTED']).default('COMMITTED'),
  operationId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const ProposalMarkerSchema = z.union([ProposalMarkerV2Schema, ProposalMarkerV3Schema]);
/** Proposal pluginData 的结构化类型。 */
export type ProposalMarker = z.infer<typeof ProposalMarkerSchema>;

export const CloneScopeResolutionSchema = z.enum([
  'TARGET',
  'AUTO_LAYOUT_PARENT',
  'NEAREST_CONTAINER',
  'SHARED_CONTEXT',
  'LIMIT_FALLBACK',
]);
export type CloneScopeResolution = z.infer<typeof CloneScopeResolutionSchema>;

export const ProposalCloneRootSchema = z.object({
  sourceNodeId: z.string(),
  proposalNodeId: z.string(),
  nodeCount: z.number().int().positive(),
});

export const ProposalTargetMapSchema = z.object({
  sourceNodeId: z.string(),
  proposalNodeId: z.string(),
  cloneRootSourceNodeId: z.string(),
  resolution: CloneScopeResolutionSchema,
});

export const ProposalScopeWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
});

/** 克隆 Proposal 后返回自动范围决策、源节点映射及初始指纹。 */
export const ProposalResultSchema = z.object({
  proposalRootId: z.string(),
  requestedTargetIds: z.array(z.string()),
  cloneRoots: z.array(ProposalCloneRootSchema).min(1),
  targetMap: z.array(ProposalTargetMapSchema).min(1),
  idMap: z.record(z.string(), z.string()),
  warnings: z.array(ProposalScopeWarningSchema),
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
