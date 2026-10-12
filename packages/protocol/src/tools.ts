import { z } from 'zod';

import { DesignPlanSchema } from './design-plan.js';
import { LayoutSpecSchema, SizingSpecSchema } from './layout.js';
import { AssetExportStatusSchema, PositioningSchema } from './node.js';

/** MCP 工具输入和输出 schema 集中定义，服务端与插件共享同一边界。 */
export const EmptyInputSchema = z.object({});
export const GetNodeInputSchema = z.object({ nodeId: z.string().min(1) });
export const GetFingerprintInputSchema = z
  .object({
    nodeIds: z
      .array(z.string().min(1))
      .min(1)
      .max(1_000)
      .refine((nodeIds) => new Set(nodeIds).size === nodeIds.length, {
        message: 'nodeIds must be unique.',
      }),
  })
  .strict();
export const FingerprintResultSchema = z
  .object({
    nodeIds: z.array(z.string().min(1)).min(1),
    fingerprint: z.string().min(8),
  })
  .strict();
export type FingerprintResult = z.infer<typeof FingerprintResultSchema>;
export const GetTreeInputSchema = z
  .object({
    nodeId: z.string().min(1),
    depth: z.number().int().min(0).max(8).default(2),
    maxNodes: z.number().int().min(1).max(1_000).default(200),
    maxTextLength: z.number().int().min(0).max(80).default(80),
    delivery: z.enum(['AUTO', 'TEMP_FILE']).default('AUTO'),
  })
  .strict();
/** Figma 插件只接收遍历参数，交付策略由本地 MCP Server 决定。 */
export const GetTreeRpcInputSchema = GetTreeInputSchema.omit({ delivery: true });
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
const RelativeExportPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => !value.includes('\0'), 'Export path must not contain NUL.')
  .refine((value) => !/^(?:[a-zA-Z]:[\\/]|[\\/]{1,2})/.test(value), {
    message: 'Export path must be relative.',
  })
  .refine(
    (value) =>
      !value
        .replace(/\\/g, '/')
        .split('/')
        .some((segment) => segment === '..'),
    'Export path must not contain parent traversal.',
  );

const ExportWriteFieldsSchema = z.object({
  writePolicy: z.enum(['REUSE_OR_FAIL', 'OVERWRITE']).default('REUSE_OR_FAIL'),
  expectedExistingSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

/** 将 Agent 执行环境的工作区根绑定到当前 Adapter 会话。 */
export const BindExportRootInputSchema = z
  .object({
    rootPath: z.string().min(1).max(1_024),
    expectedSessionId: z.string().uuid(),
  })
  .strict();

/** 绑定成功后必须返回已冻结的 WORKSPACE 状态。 */
export const BindExportRootResultSchema = AssetExportStatusSchema.extend({
  delivery: z.literal('WORKSPACE'),
}).omit({ fallbackExpiresAt: true });

export const ExportRawAssetInputSchema = z
  .object({
    nodeId: z.string().min(1),
    mode: z.literal('RAW'),
    paintSlot: z.enum(['FILLS', 'STROKES']),
    paintIndex: z.number().int().nonnegative(),
    expectedImageHash: z.string().min(1),
    expectedNodeFingerprint: z.string().min(8),
    outputPathStem: RelativeExportPathSchema.refine(
      (value) => !/[.][a-zA-Z0-9]{1,8}$/.test(value.replace(/\\/g, '/').split('/').at(-1) ?? ''),
      'RAW outputPathStem must not include a file extension.',
    ),
  })
  .extend(ExportWriteFieldsSchema.shape)
  .strict();

const ExportRenderedBaseSchema = z
  .object({
    nodeId: z.string().min(1),
    mode: z.literal('RENDERED'),
    expectedTreeFingerprint: z.string().min(8),
    outputPath: RelativeExportPathSchema,
  })
  .extend(ExportWriteFieldsSchema.shape);

export const ExportRenderedAssetInputSchema = z.discriminatedUnion('format', [
  ExportRenderedBaseSchema.extend({
    format: z.enum(['PNG', 'JPG']),
    scale: z.number().positive().max(4).default(1),
  }).strict(),
  ExportRenderedBaseSchema.extend({ format: z.literal('SVG') }).strict(),
]);

export const ExportAssetInputSchema = z
  .union([ExportRawAssetInputSchema, ExportRenderedAssetInputSchema])
  .superRefine((input, context) => {
    if (input.writePolicy === 'OVERWRITE' && !input.expectedExistingSha256) {
      context.addIssue({
        code: 'custom',
        path: ['expectedExistingSha256'],
        message: 'OVERWRITE requires expectedExistingSha256.',
      });
    }
    if (input.mode !== 'RENDERED') return;
    const path = input.outputPath.toLowerCase();
    const matches =
      (input.format === 'PNG' && path.endsWith('.png')) ||
      (input.format === 'JPG' && (path.endsWith('.jpg') || path.endsWith('.jpeg'))) ||
      (input.format === 'SVG' && path.endsWith('.svg'));
    if (!matches) {
      context.addIssue({
        code: 'custom',
        path: ['outputPath'],
        message: `Output extension must match ${input.format}.`,
      });
    }
  });

/** 本地路径和覆盖策略只属于 MCP Adapter，绝不转发给 Figma 插件。 */
export const ExportAssetRpcInputSchema = z.union([
  ExportRawAssetInputSchema.omit({
    outputPathStem: true,
    writePolicy: true,
    expectedExistingSha256: true,
  }),
  z.discriminatedUnion('format', [
    ExportRenderedBaseSchema.omit({
      outputPath: true,
      writePolicy: true,
      expectedExistingSha256: true,
    })
      .extend({ format: z.enum(['PNG', 'JPG']), scale: z.number().positive().max(4).default(1) })
      .strict(),
    ExportRenderedBaseSchema.omit({
      outputPath: true,
      writePolicy: true,
      expectedExistingSha256: true,
    })
      .extend({ format: z.literal('SVG') })
      .strict(),
  ]),
]);

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

/** 插件内部渲染 RPC 携带 base64；该 schema 不得直接作为 MCP 工具输出。 */
export const RenderRpcResultSchema = z
  .object({
    nodeId: z.string(),
    mimeType: z.literal('image/png'),
    data: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    fingerprint: z.string(),
  })
  .strict();

/** MCP 公开渲染结果只暴露短期本地文件，不包含图片正文。 */
export const RenderResultSchema = z
  .object({
    nodeId: z.string(),
    mimeType: z.literal('image/png'),
    width: z.number().positive(),
    height: z.number().positive(),
    fingerprint: z.string(),
    localPath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

/** 插件内部导出结果携带受限数据，但不能直接作为 MCP 工具结果返回。 */
export const ExportAssetRpcResultSchema = z.object({
  nodeId: z.string(),
  mode: z.enum(['RAW', 'RENDERED']),
  format: z.enum(['ORIGINAL', 'PNG', 'JPG', 'SVG']),
  mimeType: z.string(),
  data: z.string(),
  encoding: z.enum(['base64', 'utf8']),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  source: z
    .object({
      imageHash: z.string().optional(),
      nodeFingerprint: z.string().optional(),
      treeFingerprint: z.string().optional(),
    })
    .strict(),
});

/** MCP 公开结果只包含落盘后的路径与摘要，不包含素材正文。 */
export const ExportAssetResultSchema = z
  .object({
    nodeId: z.string(),
    mode: z.enum(['RAW', 'RENDERED']),
    format: z.enum(['PNG', 'JPG', 'GIF', 'WEBP', 'SVG']),
    mimeType: z.string(),
    status: z.enum(['CREATED', 'REUSED', 'UPDATED']),
    delivery: z.enum(['WORKSPACE', 'STAGED']),
    projectRelativePath: z.string().min(1),
    absolutePath: z.string().min(1),
    requiresCopy: z.boolean(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    source: z
      .object({
        imageHash: z.string().optional(),
        nodeFingerprint: z.string().optional(),
        treeFingerprint: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type ExportAssetResult = z.infer<typeof ExportAssetResultSchema>;

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
