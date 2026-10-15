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
  /** 包含阴影和外描边的页面绝对渲染边界；轻量树可以省略。 */
  absoluteRenderBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
  rotation: z.number(),
});
/** 节点几何快照类型。 */
export type Geometry = z.infer<typeof GeometrySchema>;

/** 对外投影省略零旋转，并允许去掉与 absolute 重复的渲染边界。 */
export const CompactGeometrySchema = GeometrySchema.omit({ rotation: true }).extend({
  rotation: z.number().optional(),
});
export type CompactGeometry = z.infer<typeof CompactGeometrySchema>;

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
      minWidth: z.number().nonnegative().optional(),
      maxWidth: z.number().nonnegative().optional(),
      minHeight: z.number().nonnegative().optional(),
      maxHeight: z.number().nonnegative().optional(),
    })
    .optional(),
  positioning: PositioningSchema.optional(),
  item: z
    .object({
      align: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT']).optional(),
      grow: z.number().nonnegative().optional(),
    })
    .optional(),
  primaryAxisAlign: z.string().optional(),
  counterAxisAlign: z.string().optional(),
  counterAxisAlignContent: z.string().optional(),
  counterAxisSpacing: z.number().nullable().optional(),
  itemReverseZIndex: z.boolean().optional(),
  strokesIncludedInLayout: z.boolean().optional(),
  constraints: z.object({ horizontal: z.string(), vertical: z.string() }).optional(),
  overflow: z
    .object({
      direction: z.string(),
      fixedChildCount: z.number().int().nonnegative(),
    })
    .optional(),
  grid: z
    .object({
      rowCount: z.number().int().nonnegative(),
      columnCount: z.number().int().nonnegative(),
      rowGap: z.number(),
      columnGap: z.number(),
      rowSizes: z.json(),
      columnSizes: z.json(),
      autoTracks: z.enum(['NONE', 'ROWS']),
      itemsPositioning: z.enum(['MANUAL', 'ROW_AUTO_FLOW']),
    })
    .optional(),
  gridItem: z
    .object({
      rowAnchorIndex: z.number().int().nonnegative(),
      columnAnchorIndex: z.number().int().nonnegative(),
      rowSpan: z.number().int().positive(),
      columnSpan: z.number().int().positive(),
      horizontalAlign: z.enum(['MIN', 'CENTER', 'MAX', 'AUTO']),
      verticalAlign: z.enum(['MIN', 'CENTER', 'MAX', 'AUTO']),
    })
    .optional(),
});
/** 节点布局快照类型。 */
export type LayoutSnapshot = z.infer<typeof LayoutSnapshotSchema>;

/** 文本快照会标记截断和缺失字体，避免调用方误把摘要当成完整文本。 */
export const TextStyleRunSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    fontName: z.json().optional(),
    fontSize: z.number().positive().optional(),
    fontWeight: z.number().optional(),
    lineHeight: z.json().optional(),
    letterSpacing: z.json().optional(),
    textCase: z.string().optional(),
    textDecoration: z.string().optional(),
    fills: z.json().optional(),
    hyperlink: z.json().optional(),
    textStyleId: z.string().optional(),
    fillStyleId: z.string().optional(),
  })
  .strict();

/** 文本快照的常用排版事实；混合样式仅返回有界的样式区间。 */
export const TextSnapshotSchema = z.object({
  characters: z.string(),
  truncated: z.boolean(),
  fontName: z.json().optional(),
  fontSize: z.json().optional(),
  lineHeight: z.json().optional(),
  letterSpacing: z.json().optional(),
  textAlignHorizontal: z.string().optional(),
  textAlignVertical: z.string().optional(),
  textAutoResize: z.string().optional(),
  textTruncation: z.string().optional(),
  maxLines: z.number().int().positive().nullable().optional(),
  paragraphIndent: z.json().optional(),
  paragraphSpacing: z.json().optional(),
  listSpacing: z.json().optional(),
  textCase: z.json().optional(),
  textDecoration: z.json().optional(),
  runs: z.array(TextStyleRunSchema).max(64).optional(),
  runsTruncated: z.literal(true).optional(),
  hasMissingFont: z.boolean().optional(),
});

/** 紧凑文本事实只在发生截断时返回标志，false 由字段缺省表达。 */
export const CompactTextSnapshotSchema = TextSnapshotSchema.omit({ truncated: true }).extend({
  truncated: z.literal(true).optional(),
});

/** 可序列化的视觉属性摘要。 */
export const VisualSnapshotSchema = z.object({
  opacity: z.number().optional(),
  blendMode: z.string().optional(),
  fills: z.json().optional(),
  strokes: z.json().optional(),
  strokeWeight: z.json().optional(),
  strokeAlign: z.string().optional(),
  dashPattern: z.array(z.number()).optional(),
  strokeCap: z.json().optional(),
  strokeJoin: z.json().optional(),
  strokeMiterLimit: z.number().optional(),
  individualStrokeWeights: z
    .object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
    })
    .optional(),
  cornerRadius: z.json().optional(),
  cornerSmoothing: z.number().min(0).max(1).optional(),
  cornerRadii: z
    .object({
      topLeft: z.number().nonnegative(),
      topRight: z.number().nonnegative(),
      bottomRight: z.number().nonnegative(),
      bottomLeft: z.number().nonnegative(),
    })
    .optional(),
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

/** 紧凑素材事实不保留空数组或无效的非蒙版外壳。 */
export const CompactNodeAssetSnapshotSchema = NodeAssetSnapshotSchema.extend({
  imagePaints: NodeAssetSnapshotSchema.shape.imagePaints.optional(),
  exportSettings: NodeAssetSnapshotSchema.shape.exportSettings.optional(),
});

/** Component、Component Set 和 Instance 的关联信息。 */
export const ComponentSnapshotSchema = z.object({
  kind: z.enum(['COMPONENT', 'COMPONENT_SET', 'INSTANCE']),
  mainComponentId: z.string().nullable().optional(),
  properties: z.json().optional(),
  componentPropertyDefinitions: z.json().optional(),
});

/** 树节点的轻量摘要，供插件内部状态和 children 列表复用。 */
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

/** MCP 公开子节点摘要不重复当前根 ID，并保留后续定向读取所需的节点 ID。 */
export const PublicNodeChildSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    geometry: CompactGeometrySchema.optional(),
  })
  .strict();

/** MCP 公开节点结果是按字段组投影的紧凑事实，不暴露内部一致性指纹。 */
export const NodeResultSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    parentId: z.string().optional(),
    geometry: CompactGeometrySchema.optional(),
    visible: z.literal(false).optional(),
    locked: z.literal(true).optional(),
    layout: LayoutSnapshotSchema.optional(),
    text: CompactTextSnapshotSchema.optional(),
    visual: VisualSnapshotSchema.optional(),
    assets: CompactNodeAssetSnapshotSchema.optional(),
    component: ComponentSnapshotSchema.optional(),
    children: z.array(PublicNodeChildSchema).optional(),
  })
  .strict();
export type NodeResult = z.infer<typeof NodeResultSchema>;

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

export const TreeTruncationSchema = z
  .object({
    reasons: z.array(z.enum(['DEPTH_LIMIT', 'NODE_LIMIT'])).min(1),
    frontierNodeIds: z.array(z.string()),
    omittedChildCount: z.number().int().nonnegative(),
  })
  .strict();

export const TreeCoverageSchema = z
  .object({
    complete: z.boolean(),
    nodeCount: z.number().int().positive(),
    truncation: TreeTruncationSchema.optional(),
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

/** MCP 公开树只保留导航所需的父坐标系边界和非默认提示。 */
export type PublicTreeNode = {
  id: string;
  name: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  childCount: number;
  visible?: false | undefined;
  layoutMode?: z.infer<typeof LayoutModeSchema> | undefined;
  positioning?: z.infer<typeof PositioningSchema> | undefined;
  textPreview?: z.infer<typeof TreeTextPreviewSchema> | undefined;
  componentKind?: 'INSTANCE' | 'COMPONENT' | 'COMPONENT_SET' | undefined;
  assetHints?: z.infer<typeof TreeAssetHintsSchema> | undefined;
  children: PublicTreeNode[];
};
export const PublicTreeNodeSchema: z.ZodType<PublicTreeNode> = z
  .object({
    id: z.string(),
    name: z.string().max(200),
    type: z.string(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
      })
      .strict(),
    childCount: z.number().int().nonnegative(),
    visible: z.literal(false).optional(),
    layoutMode: LayoutModeSchema.optional(),
    positioning: PositioningSchema.optional(),
    textPreview: TreeTextPreviewSchema.optional(),
    componentKind: z.enum(['INSTANCE', 'COMPONENT', 'COMPONENT_SET']).optional(),
    assetHints: TreeAssetHintsSchema.optional(),
    children: z.lazy(() => z.array(PublicTreeNodeSchema)),
  })
  .strict();

/** MCP 公开树结果用字段是否存在表达截断和临时交付。 */
export const TreeResultSchema = z
  .object({
    root: PublicTreeNodeSchema,
    truncation: TreeTruncationSchema.optional(),
    artifact: z
      .object({
        localPath: z.string().min(1),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .optional(),
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

/** 插件内部 status RPC 保留连接诊断信息，不直接作为 MCP 工具结果。 */
export const PluginStatusResultSchema = z.object({
  connected: z.boolean(),
  authenticated: z.boolean(),
  protocolVersion: z.number().int(),
  pluginVersion: z.string().optional(),
  document: z.object({ id: z.string().optional(), name: z.string() }).optional(),
  page: z.object({ id: z.string(), name: z.string() }).optional(),
  selection: z.array(NodeSummarySchema),
  capabilities: z.array(z.string()),
});
export type PluginStatusResult = z.infer<typeof PluginStatusResultSchema>;

/** MCP 公开工作区状态只暴露 Agent 下一步绑定或写入所需的信息。 */
export const WorkspaceStatusSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('UNBOUND'),
      sessionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      state: z.literal('BOUND'),
      sessionId: z.string().uuid(),
      rootPath: z.string().min(1),
    })
    .strict(),
]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

/** status 工具只返回当前设计上下文和本次 Adapter 的工作区状态。 */
export const StatusResultSchema = z
  .object({
    document: z.object({ name: z.string() }).strict(),
    page: z.object({ id: z.string(), name: z.string() }).strict(),
    selection: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          parentId: z.string().optional(),
        })
        .strict(),
    ),
    workspace: WorkspaceStatusSchema,
  })
  .strict();
/** 插件状态结果类型。 */
export type StatusResult = z.infer<typeof StatusResultSchema>;
