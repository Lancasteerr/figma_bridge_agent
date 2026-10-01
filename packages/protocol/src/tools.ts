import { z } from 'zod';

import { DesignPlanSchema } from './design-plan.js';
import { LayoutSpecSchema, SizingSpecSchema } from './layout.js';
import { PositioningSchema } from './node.js';

/** MCP 工具输入和输出 schema 集中定义，服务端与插件共享同一边界。 */
export const EmptyInputSchema = z.object({});
export const GetNodeInputSchema = z.object({ nodeId: z.string().min(1) });
export const GetTreeInputSchema = z.object({
  nodeId: z.string().min(1),
  depth: z.number().int().min(0).max(8).default(2),
  maxNodes: z.number().int().min(1).max(1000).default(200),
  maxTextLength: z.number().int().min(0).max(10_000).default(2_000),
});
// depth、maxNodes 和 maxTextLength 同时限制递归结果和单个文本字段，避免读取工具生成失控 payload。
export const RenderNodeInputSchema = z.object({
  nodeId: z.string().min(1),
  scale: z.number().positive().max(4).default(1),
  maxDimension: z.number().int().min(64).max(2048).default(2048),
});
export const GetCssInputSchema = GetNodeInputSchema;
export const GetRawNodeInputSchema = GetNodeInputSchema.extend({
  maxBytes: z
    .number()
    .int()
    .min(1_024)
    .max(8 * 1024 * 1024)
    .default(2 * 1024 * 1024),
});
export const GetVariablesInputSchema = z.object({
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1_000).default(200),
});
export const ExportAssetInputSchema = z.object({
  nodeId: z.string().min(1),
  format: z.enum(['PNG', 'SVG']),
  scale: z.number().positive().max(4).default(1),
});

export const DuplicateProposalInputSchema = z
  .object({
    editTargetNodeIds: z.array(z.string().min(1)).min(1).optional(),
    nameSuffix: z.string().min(1).max(100).default(' / Agent Proposal'),
    offsetX: z.number().default(64),
    offsetY: z.number().default(0),
  })
  .strict();
/** 所有 Proposal 内部写操作都必须携带根节点，并可用指纹做乐观并发校验。 */
export const ProposalTargetSchema = z.object({
  proposalRootId: z.string().min(1),
  expectedFingerprint: z.string().min(8).optional(),
});
export const CreateFrameInputSchema = ProposalTargetSchema.extend({
  parentId: z.string().min(1),
  name: z.string().min(1).max(200),
  index: z.number().int().nonnegative().optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().default(100),
  height: z.number().positive().default(100),
});
export const ReparentNodesInputSchema = ProposalTargetSchema.extend({
  nodeIds: z.array(z.string().min(1)).min(1),
  parentId: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
  placement: z.enum(['FLOW', 'ABSOLUTE']),
  preserveAbsolutePosition: z.boolean().default(true),
});
export const SetLayoutInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
  layout: LayoutSpecSchema.optional(),
  sizing: SizingSpecSchema.optional(),
  positioning: PositioningSchema.optional(),
  absolute: z.object({ x: z.number(), y: z.number() }).optional(),
});
export const UpdateTextInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
  characters: z.string().optional(),
  fontName: z.object({ family: z.string(), style: z.string() }).optional(),
  fontSize: z.number().positive().optional(),
  lineHeight: z.number().positive().optional(),
});
export const SetInstancePropertiesInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
  properties: z.record(z.string(), z.union([z.string(), z.boolean()])),
});
export const CreateComponentInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
});
export const DiscardProposalInputSchema = z.object({
  proposalRootId: z.string().min(1),
  expectedFingerprint: z.string().min(8),
});
export const ValidateDesignPlanInputSchema = z.object({ plan: DesignPlanSchema });
export const ApplyDesignPlanInputSchema = z.object({ validationId: z.string().min(1) });

/** PNG 渲染结果可附带本地临时文件信息，但 data 始终是插件返回的 base64。 */
export const RenderResultSchema = z.object({
  nodeId: z.string(),
  mimeType: z.literal('image/png'),
  data: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  fingerprint: z.string(),
  localPath: z.string().optional(),
  sha256: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
});

/** 资源导出允许 PNG/SVG，并通过 encoding 区分二进制和文本数据。 */
export const ExportResultSchema = z.object({
  nodeId: z.string(),
  format: z.enum(['PNG', 'SVG']),
  mimeType: z.string(),
  data: z.string().optional(),
  encoding: z.enum(['base64', 'utf8']).optional(),
  suggestedName: z.string(),
  fingerprint: z.string(),
  localPath: z.string().optional(),
  sha256: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
});

/** CSS 结果是提示性映射，不承诺可直接还原为完整 Figma 样式。 */
export const CssResultSchema = z.object({
  nodeId: z.string(),
  hintOnly: z.literal(true),
  properties: z.record(z.string(), z.string()),
});

/** Variables 使用 cursor 分页，避免一次性返回过多变量定义。 */
export const VariablesResultSchema = z.object({
  cursor: z.number().int().nonnegative(),
  nextCursor: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative(),
  variables: z.array(z.unknown()),
  collections: z.array(z.unknown()),
});

/** 原始节点 JSON 结果显式返回字节数，便于调用方处理 payload 限制。 */
export const RawNodeResultSchema = z.object({
  nodeId: z.string(),
  json: z.string(),
  bytes: z.number().int().nonnegative(),
});
