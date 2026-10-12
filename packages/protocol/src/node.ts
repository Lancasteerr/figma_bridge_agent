import { z } from 'zod';

/** 节点在本地父级和页面绝对坐标系中的几何信息。 */
export const GeometrySchema = z.object({
  local: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  absolute: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    })
    .nullable(),
  rotation: z.number(),
});
/** 节点几何快照类型。 */
export type Geometry = z.infer<typeof GeometrySchema>;

/** Figma Auto Layout 的尺寸策略和节点布局模式。 */
export const AxisSizingSchema = z.enum(['FIXED', 'HUG', 'FILL']);
export const LayoutModeSchema = z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']);
export const PositioningSchema = z.enum(['AUTO', 'ABSOLUTE']);

/** 只读节点快照中的布局字段，可能包含当前版本暂不支持写回的能力。 */
export const LayoutSnapshotSchema = z.object({
  mode: LayoutModeSchema.optional(),
  wrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
  gap: z.number().optional(),
  padding: z
    .object({
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
      left: z.number(),
    })
    .optional(),
  sizing: z
    .object({
      horizontal: AxisSizingSchema.optional(),
      vertical: AxisSizingSchema.optional(),
    })
    .optional(),
  positioning: PositioningSchema.optional(),
  primaryAxisAlign: z.string().optional(),
  counterAxisAlign: z.string().optional(),
  constraints: z.object({ horizontal: z.string(), vertical: z.string() }).optional(),
});
/** 节点布局快照类型。 */
export type LayoutSnapshot = z.infer<typeof LayoutSnapshotSchema>;

/** 文本快照会标记截断和缺失字体，避免调用方误把摘要当成完整文本。 */
export const TextSnapshotSchema = z.object({
  characters: z.string(),
  truncated: z.boolean(),
  fontName: z.json().optional(),
  fontSize: z.json().optional(),
  lineHeight: z.json().optional(),
  letterSpacing: z.json().optional(),
  textAlignHorizontal: z.string().optional(),
  hasMissingFont: z.boolean().optional(),
});

/** 可序列化的视觉属性摘要。 */
export const VisualSnapshotSchema = z.object({
  opacity: z.number().optional(),
  blendMode: z.string().optional(),
  fills: z.json().optional(),
  strokes: z.json().optional(),
  strokeWeight: z.json().optional(),
  cornerRadius: z.json().optional(),
  effects: z.json().optional(),
  clipsContent: z.boolean().optional(),
});

/** 从节点视觉属性中提取的素材事实，只辅助 Agent 判断，不替代原始 visual 快照。 */
export const NodeAssetSnapshotSchema = z
  .object({
    imagePaints: z.array(
      z
        .object({
          paintSlot: z.enum(['FILLS', 'STROKES']),
          paintIndex: z.number().int().nonnegative(),
          imageHash: z.string(),
          imageSize: z
            .object({ width: z.number().positive(), height: z.number().positive() })
            .optional(),
          imageSizeUnavailable: z.literal(true).optional(),
          imageSizeError: z
            .enum(['EMPTY_IMAGE_HASH', 'IMAGE_NOT_FOUND', 'QUERY_FAILED'])
            .optional(),
          scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']),
          imageTransform: z.array(z.array(z.number())).optional(),
          scalingFactor: z.number().optional(),
          rotation: z.number().optional(),
          filters: z.json().optional(),
          opacity: z.number().optional(),
          blendMode: z.string().optional(),
          visible: z.boolean().optional(),
        })
        .strict(),
    ),
    exportSettings: z.array(
      z
        .object({
          format: z.enum(['PNG', 'JPG', 'SVG', 'PDF']),
          suffix: z.string().optional(),
          constraint: z
            .object({
              type: z.enum(['SCALE', 'WIDTH', 'HEIGHT']),
              value: z.number().positive(),
            })
            .optional(),
          contentsOnly: z.boolean().optional(),
          useAbsoluteBounds: z.boolean().optional(),
        })
        .strict(),
    ),
    vector: z
      .object({
        pathCount: z.number().int().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    mask: z
      .object({
        isMask: z.boolean(),
        maskType: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type NodeAssetSnapshot = z.infer<typeof NodeAssetSnapshotSchema>;

/** Component、Component Set 和 Instance 的关联信息。 */
export const ComponentSnapshotSchema = z.object({
  kind: z.enum(['COMPONENT', 'COMPONENT_SET', 'INSTANCE']),
  mainComponentId: z.string().nullable().optional(),
  properties: z.json().optional(),
  componentPropertyDefinitions: z.json().optional(),
});

/** 树节点的轻量摘要，供 selection 和 children 列表复用。 */
export const NodeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().optional(),
  geometry: GeometrySchema.optional(),
});
/** 节点摘要类型。 */
export type NodeSummary = z.infer<typeof NodeSummarySchema>;

/** 完整节点快照；children 使用摘要以控制树结果大小。 */
export const NodeSnapshotSchema = NodeSummarySchema.extend({
  pageId: z.string(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  layout: LayoutSnapshotSchema.optional(),
  text: TextSnapshotSchema.optional(),
  visual: VisualSnapshotSchema.optional(),
  assets: NodeAssetSnapshotSchema.optional(),
  component: ComponentSnapshotSchema.optional(),
  children: z.array(NodeSummarySchema),
  fingerprint: z.string().min(8),
  truncated: z.boolean(),
});
/** 完整节点快照类型。 */
export type NodeSnapshot = z.infer<typeof NodeSnapshotSchema>;

/** 轻量树中的文本仅用于导航，不能作为实现时的完整文案来源。 */
export const TreeTextPreviewSchema = z
  .object({ value: z.string().max(80), truncated: z.boolean() })
  .strict();

/** 轻量素材提示只读取节点现成属性，不触发图片尺寸或组件异步查询。 */
export const TreeAssetHintsSchema = z
  .object({
    imagePaintCount: z.number().int().nonnegative(),
    exportSettingCount: z.number().int().nonnegative(),
    hasVector: z.boolean(),
    isMask: z.boolean(),
  })
  .strict();

const LightweightTreeNodeFieldsSchema = z
  .object({
    id: z.string(),
    parentId: z.string().optional(),
    order: z.number().int().nonnegative(),
    name: z.string().max(200),
    type: z.string(),
    visible: z.boolean(),
    geometry: GeometrySchema,
    childCount: z.number().int().nonnegative(),
    layoutMode: LayoutModeSchema.optional(),
    positioning: PositioningSchema.optional(),
    textPreview: TreeTextPreviewSchema.optional(),
    componentHint: z
      .object({ kind: z.enum(['INSTANCE', 'COMPONENT', 'COMPONENT_SET']) })
      .strict()
      .optional(),
    assetHints: TreeAssetHintsSchema,
  })
  .strict();

/** JSONL 中每个节点使用扁平记录，由 parentId 和 order 恢复层级。 */
export const LightweightTreeNodeRecordSchema = LightweightTreeNodeFieldsSchema;
export type LightweightTreeNodeRecord = z.infer<typeof LightweightTreeNodeRecordSchema>;

/** MCP 内联树使用递归 children，字段仍保持导航级轻量。 */
export type LightweightTreeNode = LightweightTreeNodeRecord & {
  children: LightweightTreeNode[];
};
export const LightweightTreeNodeSchema: z.ZodType<LightweightTreeNode> =
  LightweightTreeNodeFieldsSchema.extend({
    children: z.lazy(() => z.array(LightweightTreeNodeSchema)),
  });

export const TreeScopeSchema = z
  .object({
    rootNodeId: z.string(),
    requestedDepth: z.number().int().nonnegative(),
    maxNodes: z.number().int().positive(),
  })
  .strict();

export const TreeCoverageSchema = z
  .object({
    complete: z.boolean(),
    nodeCount: z.number().int().positive(),
    truncation: z
      .object({
        reasons: z.array(z.enum(['DEPTH_LIMIT', 'NODE_LIMIT'])).min(1),
        frontierNodeIds: z.array(z.string()),
        omittedChildCount: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (coverage.complete === Boolean(coverage.truncation)) {
      context.addIssue({
        code: 'custom',
        message: 'Complete coverage must not include truncation, and incomplete coverage must.',
      });
    }
  });

/** 插件 RPC 只返回完整的轻量树，不参与本地文件交付决策。 */
export const TreeRpcResultSchema = z
  .object({
    schemaVersion: z.literal(2),
    scope: TreeScopeSchema,
    coverage: TreeCoverageSchema,
    root: LightweightTreeNodeSchema,
  })
  .strict();
export type TreeRpcResult = z.infer<typeof TreeRpcResultSchema>;

export const TreeDeliverySchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('INLINE'),
      inlineComplete: z.literal(true),
      inlineNodeCount: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('TEMP_FILE'),
      inlineComplete: z.literal(false),
      inlineNodeCount: z.number().int().positive(),
      artifactNodeCount: z.number().int().positive(),
      localPath: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().positive(),
      createdAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
    })
    .strict(),
]);

/** MCP 公开树结果将 Figma 覆盖状态和模型内联状态严格分开。 */
export const TreeResultSchema = z
  .object({
    schemaVersion: z.literal(2),
    scope: TreeScopeSchema,
    coverage: TreeCoverageSchema,
    delivery: TreeDeliverySchema,
    root: LightweightTreeNodeSchema,
  })
  .strict();
export type TreeResult = z.infer<typeof TreeResultSchema>;

/** 临时 JSONL 首行携带范围和覆盖状态，后续行才是扁平节点记录。 */
export const TreeArtifactManifestSchema = z
  .object({
    recordType: z.literal('manifest'),
    schemaVersion: z.literal(2),
    scope: TreeScopeSchema,
    coverage: TreeCoverageSchema,
  })
  .strict();

/** 当前页面和当前选区的只读结果。 */
export const SelectionResultSchema = z.object({
  page: z.object({ id: z.string(), name: z.string() }),
  selection: z.array(NodeSummarySchema),
});

/** Adapter 会话级的素材导出交付状态。 */
export const AssetExportStatusSchema = z
  .object({
    delivery: z.enum(['WORKSPACE', 'STAGED']),
    rootPath: z.string().min(1),
    sessionId: z.string().uuid(),
    fallbackExpiresAt: z.string().datetime().optional(),
  })
  .strict();
/** 素材导出交付状态类型。 */
export type AssetExportStatus = z.infer<typeof AssetExportStatusSchema>;

/** status 工具返回的连接、页面、选区和能力信息。 */
export const StatusResultSchema = z.object({
  connected: z.boolean(),
  authenticated: z.boolean(),
  protocolVersion: z.number().int(),
  pluginVersion: z.string().optional(),
  document: z.object({ id: z.string().optional(), name: z.string() }).optional(),
  page: z.object({ id: z.string(), name: z.string() }).optional(),
  selection: z.array(NodeSummarySchema),
  capabilities: z.array(z.string()),
  assetExport: AssetExportStatusSchema.optional(),
});
/** 插件状态结果类型。 */
export type StatusResult = z.infer<typeof StatusResultSchema>;
