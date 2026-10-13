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
  planDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
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

export const ProposalTargetMapSchema = z
  .object({
    sourceNodeId: z.string(),
    proposalNodeId: z.string(),
    resolution: CloneScopeResolutionSchema,
  })
  .strict();

export const ProposalScopeWarningSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    nodeId: z.string().optional(),
  })
  .strict();

/** 克隆 Proposal 后只返回请求目标映射及后续写入所需的根指纹。 */
export const ProposalResultSchema = z
  .object({
    proposalRootId: z.string(),
    targetMap: z.array(ProposalTargetMapSchema).min(1),
    warnings: z.array(ProposalScopeWarningSchema).min(1).optional(),
    proposalFingerprint: z.string().min(8),
  })
  .strict();
/** 创建 Proposal 的结果类型。 */
export type ProposalResult = z.infer<typeof ProposalResultSchema>;

/** 创建节点时返回新 ID；其余变更只需要新的 Proposal 指纹。 */
export const CreateFrameResultSchema = z
  .object({ nodeId: z.string(), proposalFingerprint: z.string().min(8) })
  .strict();
export type CreateFrameResult = z.infer<typeof CreateFrameResultSchema>;
export const MutationResultSchema = z.object({ proposalFingerprint: z.string().min(8) }).strict();
/** Proposal 变更结果类型。 */
export type MutationResult = z.infer<typeof MutationResultSchema>;

/** 仅当根节点被 Component 替换时，调用方才需要更新 Proposal 根 ID。 */
export const CreateComponentResultSchema = z
  .object({
    componentId: z.string(),
    newProposalRootId: z.string().optional(),
    proposalFingerprint: z.string().min(8),
  })
  .strict();
/** Component 创建结果类型。 */
export type CreateComponentResult = z.infer<typeof CreateComponentResultSchema>;

/** 丢弃成功无需回显调用方已知的根 ID。 */
export const DiscardProposalResultSchema = z.object({}).strict();
