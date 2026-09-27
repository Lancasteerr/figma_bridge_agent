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
  component: ComponentSnapshotSchema.optional(),
  children: z.array(NodeSummarySchema),
  fingerprint: z.string().min(8),
  truncated: z.boolean(),
});
/** 完整节点快照类型。 */
export type NodeSnapshot = z.infer<typeof NodeSnapshotSchema>;

/** 递归树结果中的节点类型，和 NodeSnapshot 保持相同字段。 */
export type SnapshotTreeNode = NodeSnapshot & { children: SnapshotTreeNode[] };
export const SnapshotTreeNodeSchema: z.ZodType<SnapshotTreeNode> = NodeSnapshotSchema.extend({
  children: z.lazy(() => z.array(SnapshotTreeNodeSchema)),
});

export const TreeResultSchema = z.object({
  root: SnapshotTreeNodeSchema,
  nodeCount: z.number().int().positive(),
  truncated: z.boolean(),
});
/** getTree 的根节点、计数和截断状态。 */
export type TreeResult = z.infer<typeof TreeResultSchema>;

/** 当前页面和当前选区的只读结果。 */
export const SelectionResultSchema = z.object({
  page: z.object({ id: z.string(), name: z.string() }),
  selection: z.array(NodeSummarySchema),
});

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
});
/** 插件状态结果类型。 */
export type StatusResult = z.infer<typeof StatusResultSchema>;
