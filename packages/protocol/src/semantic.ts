import { z } from 'zod';

import {
  ComponentSnapshotSchema,
  GeometrySchema,
  LayoutSnapshotSchema,
  NodeAssetSnapshotSchema,
  TextSnapshotSchema,
  VisualSnapshotSchema,
} from './node.js';

/** 语义快照只提供轻量结构或面向实现的完整事实，不在工具内判断视觉角色。 */
export const SemanticSnapshotProfileSchema = z.enum(['OUTLINE', 'IMPLEMENTATION']);
export type SemanticSnapshotProfile = z.infer<typeof SemanticSnapshotProfileSchema>;

export const SemanticTruncationReasonSchema = z.enum([
  'DEPTH_LIMIT',
  'NODE_LIMIT',
  'TEXT_LIMIT',
  'BYTE_LIMIT',
]);

/** 截断结果保留原因和未遍历前沿，调用方可以精确拆分后续范围。 */
export const SemanticTruncationSchema = z
  .object({
    reasons: z.array(SemanticTruncationReasonSchema).min(1),
    frontierNodeIds: z.array(z.string()),
    omittedChildCount: z.number().int().nonnegative(),
  })
  .strict();
export type SemanticTruncation = z.infer<typeof SemanticTruncationSchema>;

/** JSONL outline 的单行结构；order 是节点在父级中的稳定零基序号。 */
export const SemanticOutlineRecordSchema = z
  .object({
    nodeId: z.string(),
    parentId: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    order: z.number().int().nonnegative(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    geometry: GeometrySchema.optional(),
    layoutMode: z.string().optional(),
    childCount: z.number().int().nonnegative(),
  })
  .strict();
export type SemanticOutlineRecord = z.infer<typeof SemanticOutlineRecordSchema>;

/** JSONL facts 的单行结构不重复 children，只保存该节点自身的规范化事实。 */
export const SemanticFactRecordSchema = z
  .object({
    nodeId: z.string(),
    parentId: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    order: z.number().int().nonnegative(),
    name: z.string(),
    type: z.string(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    geometry: GeometrySchema.optional(),
    layout: LayoutSnapshotSchema.optional(),
    text: TextSnapshotSchema.optional(),
    visual: VisualSnapshotSchema.optional(),
    assets: NodeAssetSnapshotSchema.optional(),
    component: ComponentSnapshotSchema.optional(),
  })
  .strict();
export type SemanticFactRecord = z.infer<typeof SemanticFactRecordSchema>;

const SemanticScopeBaseInputSchema = z.object({
  rootNodeId: z.string().min(1),
  profile: SemanticSnapshotProfileSchema,
  focusNodeIds: z.array(z.string().min(1)).max(200).optional(),
  includeRender: z.boolean().default(false),
  depth: z.number().int().min(0).max(16).default(8),
  maxNodes: z.number().int().min(1).max(1_000).default(200),
  maxTextLength: z.number().int().min(0).max(10_000).default(500),
});

/** 公开工具额外绑定当前 Adapter 会话，防止旧任务向新会话写文件。 */
export const ExportSemanticScopeInputSchema = SemanticScopeBaseInputSchema.extend({
  expectedSessionId: z.string().uuid(),
}).strict();

/** 插件只接收 Figma 读取参数，不接触本地会话和路径。 */
export const ExportSemanticScopeRpcInputSchema = SemanticScopeBaseInputSchema.strict();

export const SemanticRenderPayloadSchema = z
  .object({
    mimeType: z.literal('image/png'),
    data: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

/** 插件到 Adapter 的私有结果可以携带正文，公开 MCP 结果绝不复用该结构。 */
export const ExportSemanticScopeRpcResultSchema = z
  .object({
    rootNodeId: z.string(),
    rootNodeName: z.string(),
    pageId: z.string(),
    profile: SemanticSnapshotProfileSchema,
    sourceFingerprint: z.string().min(8),
    nodeCount: z.number().int().nonnegative(),
    complete: z.boolean(),
    truncation: SemanticTruncationSchema.nullable(),
    outlineJsonl: z.string(),
    factsJsonl: z.string(),
    render: SemanticRenderPayloadSchema.optional(),
  })
  .strict();
export type ExportSemanticScopeRpcResult = z.infer<typeof ExportSemanticScopeRpcResultSchema>;

/** 公开导出结果仅返回磁盘引用、摘要和完整性状态。 */
export const ExportSemanticScopeResultSchema = z
  .object({
    sessionId: z.string().uuid(),
    scopeId: z.string(),
    rootNodeId: z.string(),
    sourceFingerprint: z.string().min(8),
    delivery: z.enum(['WORKSPACE', 'STAGED']),
    projectRelativePath: z.string(),
    absolutePath: z.string(),
    manifestPath: z.string(),
    requiresCopy: z.boolean(),
    nodeCount: z.number().int().nonnegative(),
    complete: z.boolean(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
  })
  .strict();
export type ExportSemanticScopeResult = z.infer<typeof ExportSemanticScopeResultSchema>;

export const CheckSemanticScopeInputSchema = z
  .object({
    expectedSessionId: z.string().uuid(),
    rootNodeId: z.string().min(1),
    storedFingerprint: z.string().min(8),
  })
  .strict();

export const CheckSemanticScopeRpcInputSchema = CheckSemanticScopeInputSchema.omit({
  expectedSessionId: true,
}).strict();

export const CheckSemanticScopeResultSchema = z
  .object({
    status: z.enum(['FRESH', 'STALE']),
    rootNodeId: z.string(),
    storedFingerprint: z.string().min(8),
    currentFingerprint: z.string().min(8),
  })
  .strict();
export type CheckSemanticScopeResult = z.infer<typeof CheckSemanticScopeResultSchema>;

/** manifest 是磁盘格式的一部分，schemaVersion 允许未来并行读取旧修订。 */
export const SemanticSnapshotManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string().uuid(),
    scopeId: z.string(),
    rootNodeId: z.string(),
    rootNodeName: z.string(),
    pageId: z.string(),
    profile: SemanticSnapshotProfileSchema,
    sourceFingerprint: z.string().min(8),
    nodeCount: z.number().int().nonnegative(),
    complete: z.boolean(),
    truncation: SemanticTruncationSchema.nullable(),
    files: z
      .object({
        outline: z.string(),
        facts: z.string(),
        render: z.string().optional(),
      })
      .strict(),
    sha256: z
      .object({
        outline: z.string().regex(/^[a-f0-9]{64}$/),
        facts: z.string().regex(/^[a-f0-9]{64}$/),
        render: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type SemanticSnapshotManifest = z.infer<typeof SemanticSnapshotManifestSchema>;
