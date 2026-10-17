import { z } from 'zod';

import {
  BoundsSchema,
  CompactNodeAssetSnapshotSchema,
  CompactTextSnapshotSchema,
  ComponentSnapshotSchema,
  LayoutSnapshotSchema,
  VisualSnapshotSchema,
} from './node.js';

export const ScopeTruncationReasonSchema = z.enum([
  'DEPTH_LIMIT',
  'NODE_LIMIT',
  'TEXT_LIMIT',
  'BYTE_LIMIT',
]);

/** 有界读取必须保留截断原因和未遍历前沿，便于调用方缩小下一次范围。 */
export const ScopeTruncationSchema = z
  .object({
    reasons: z.array(ScopeTruncationReasonSchema).min(1),
    frontierNodeIds: z.array(z.string()),
    omittedChildCount: z.number().int().nonnegative(),
  })
  .strict();
export type ScopeTruncation = z.infer<typeof ScopeTruncationSchema>;

/** 大型范围索引只保存导航事实，不能被当成实施几何。 */
export const ScopeIndexRecordSchema = z
  .object({
    nodeId: z.string(),
    parentId: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    order: z.number().int().nonnegative(),
    name: z.string(),
    type: z.string(),
    visible: z.literal(false).optional(),
    navigationBoundsInParent: BoundsSchema.shape.inParent.optional(),
    layoutMode: z.string().optional(),
    childCount: z.number().int().nonnegative(),
  })
  .strict();
export type ScopeIndexRecord = z.infer<typeof ScopeIndexRecordSchema>;

/** workunit facts 按节点平铺，禁止嵌套直接子树造成上下文重复。 */
export const WorkunitFactRecordSchema = z
  .object({
    nodeId: z.string(),
    parentId: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    order: z.number().int().nonnegative(),
    name: z.string(),
    type: z.string(),
    visible: z.literal(false).optional(),
    locked: z.literal(true).optional(),
    bounds: BoundsSchema.optional(),
    layout: LayoutSnapshotSchema.optional(),
    text: CompactTextSnapshotSchema.optional(),
    appearance: VisualSnapshotSchema.optional(),
    assetSources: CompactNodeAssetSnapshotSchema.optional(),
    component: ComponentSnapshotSchema.optional(),
  })
  .strict();
export type WorkunitFactRecord = z.infer<typeof WorkunitFactRecordSchema>;

const ScopeReadLimitsSchema = z.object({
  rootNodeId: z.string().min(1),
  depth: z.number().int().min(0).max(16).default(8),
  maxNodes: z.number().int().min(1).max(1_000).default(200),
  maxTextLength: z.number().int().min(0).max(10_000).default(500),
});

export const IndexScopeInputSchema = ScopeReadLimitsSchema.extend({
  expectedSessionId: z.string().uuid(),
}).strict();
export const IndexScopeRpcInputSchema = ScopeReadLimitsSchema.strict();

export const FidelityPolicySchema = z.enum(['EXACT', 'BALANCED']);
export const PrepareWorkunitInputSchema = ScopeReadLimitsSchema.extend({
  expectedSessionId: z.string().uuid(),
  factNodeIds: z
    .array(z.string().min(1))
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'factNodeIds must be unique.' })
    .optional(),
  includePreview: z.boolean().default(false),
  fidelityPolicy: FidelityPolicySchema.default('EXACT'),
}).strict();
export const PrepareWorkunitRpcInputSchema = PrepareWorkunitInputSchema.omit({
  expectedSessionId: true,
  fidelityPolicy: true,
}).strict();

export const WorkunitPreviewPayloadSchema = z
  .object({
    mimeType: z.literal('image/png'),
    data: z.string(),
    pixelWidth: z.number().positive(),
    pixelHeight: z.number().positive(),
  })
  .strict();

const ScopeSourceIdentitySchema = z.object({
  rootNodeId: z.string(),
  rootNodeName: z.string(),
  document: z.object({ name: z.string() }).strict(),
  page: z.object({ id: z.string(), name: z.string() }).strict(),
  sourceFingerprint: z.string().min(8),
  nodeCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  truncation: ScopeTruncationSchema.nullable(),
  outlineJsonl: z.string(),
});

export const IndexScopeRpcResultSchema = ScopeSourceIdentitySchema.extend({
  request: IndexScopeRpcInputSchema,
}).strict();
export type IndexScopeRpcResult = z.infer<typeof IndexScopeRpcResultSchema>;

export const PrepareWorkunitRpcResultSchema = ScopeSourceIdentitySchema.extend({
  request: PrepareWorkunitRpcInputSchema,
  factsJsonl: z.string(),
  preview: WorkunitPreviewPayloadSchema.optional(),
}).strict();
export type PrepareWorkunitRpcResult = z.infer<typeof PrepareWorkunitRpcResultSchema>;

export const IndexScopeResultSchema = z
  .object({
    indexManifestPath: z.string().min(1),
    structureComplete: z.boolean(),
    truncation: ScopeTruncationSchema.optional(),
  })
  .strict();
export type IndexScopeResult = z.infer<typeof IndexScopeResultSchema>;

export const PrepareWorkunitResultSchema = z
  .object({
    workUnitId: z.string().regex(/^workunit-[a-f0-9]{16}$/),
    workUnitPath: z.string().min(1),
    sourceFingerprint: z.string().min(8),
    evidenceComplete: z.boolean(),
    requiresMappingReview: z.boolean(),
    truncation: ScopeTruncationSchema.optional(),
  })
  .strict();
export type PrepareWorkunitResult = z.infer<typeof PrepareWorkunitResultSchema>;

export const WorkunitIdInputSchema = z
  .object({
    workUnitId: z.string().regex(/^workunit-[a-f0-9]{16}$/),
  })
  .strict();

export const CheckWorkunitSourceRpcInputSchema = z
  .object({ rootNodeId: z.string().min(1), storedFingerprint: z.string().min(8) })
  .strict();
export const CheckWorkunitSourceRpcResultSchema = z
  .object({
    status: z.enum(['FRESH', 'STALE']),
    rootNodeId: z.string(),
    storedFingerprint: z.string().min(8),
    currentFingerprint: z.string().min(8),
  })
  .strict();
export const CheckWorkunitSourceResultSchema = z
  .object({ status: z.enum(['FRESH', 'STALE']) })
  .strict();

export const CodeReferenceSchema = z
  .object({ path: z.string().min(1), symbolOrSelector: z.string().min(1) })
  .strict();

/** 工具只在首次 prepare 时创建此骨架；后续内容完全由 Agent 维护。 */
export const WorkunitImplementationSchema = z
  .object({
    sourceFingerprint: z.string().min(8),
    fidelityPolicy: FidelityPolicySchema,
    state: z.enum(['PLANNED', 'IMPLEMENTING', 'BLOCKED', 'COMPLETE']),
    targetFiles: z.array(z.string().min(1)),
    mappings: z.record(z.string().min(1), z.array(CodeReferenceSchema).min(1)),
    assumptions: z.array(z.string().min(1)),
    unresolvedDifferences: z.array(z.string().min(1)),
  })
  .strict();
export type WorkunitImplementation = z.infer<typeof WorkunitImplementationSchema>;

export const WorkunitCurrentSourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    workUnitId: z.string(),
    rootNodeId: z.string(),
    sourceFingerprint: z.string().min(8),
    variant: z.string(),
    manifestPath: z.string(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkunitCurrentSource = z.infer<typeof WorkunitCurrentSourceSchema>;

const StoredSourceFilesSchema = z
  .object({
    outline: z.literal('outline.jsonl'),
    facts: z.literal('facts.jsonl').optional(),
    preview: z.literal('preview.png').optional(),
  })
  .strict();

export const ScopeIndexManifestSchema = z
  .object({
    schemaVersion: z.literal(4),
    kind: z.literal('STRUCTURE_INDEX'),
    sessionId: z.string().uuid(),
    indexId: z.string(),
    rootNodeId: z.string(),
    rootNodeName: z.string(),
    page: z.object({ id: z.string(), name: z.string() }).strict(),
    request: IndexScopeRpcInputSchema,
    sourceFingerprint: z.string().min(8),
    nodeCount: z.number().int().nonnegative(),
    structureComplete: z.boolean(),
    truncation: ScopeTruncationSchema.nullable(),
    files: StoredSourceFilesSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export const WorkunitSourceManifestSchema = z
  .object({
    schemaVersion: z.literal(4),
    kind: z.literal('WORKUNIT_SOURCE'),
    normalization: z.literal('COMPACT_V2'),
    sessionId: z.string().uuid(),
    workUnitId: z.string(),
    rootNodeId: z.string(),
    rootNodeName: z.string(),
    page: z.object({ id: z.string(), name: z.string() }).strict(),
    request: PrepareWorkunitRpcInputSchema,
    sourceFingerprint: z.string().min(8),
    nodeCount: z.number().int().nonnegative(),
    evidenceComplete: z.boolean(),
    truncation: ScopeTruncationSchema.nullable(),
    files: StoredSourceFilesSchema.extend({ facts: z.literal('facts.jsonl') }),
    createdAt: z.string().datetime(),
  })
  .strict();
