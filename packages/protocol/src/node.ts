import { z } from 'zod';

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
export type Geometry = z.infer<typeof GeometrySchema>;

export const AxisSizingSchema = z.enum(['FIXED', 'HUG', 'FILL']);
export const LayoutModeSchema = z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']);
export const PositioningSchema = z.enum(['AUTO', 'ABSOLUTE']);

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
  constraints: z
    .object({ horizontal: z.string(), vertical: z.string() })
    .optional(),
});
export type LayoutSnapshot = z.infer<typeof LayoutSnapshotSchema>;

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

export const ComponentSnapshotSchema = z.object({
  kind: z.enum(['COMPONENT', 'COMPONENT_SET', 'INSTANCE']),
  mainComponentId: z.string().nullable().optional(),
  properties: z.json().optional(),
  componentPropertyDefinitions: z.json().optional(),
});

export const NodeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().optional(),
  geometry: GeometrySchema.optional(),
});
export type NodeSummary = z.infer<typeof NodeSummarySchema>;

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
export type NodeSnapshot = z.infer<typeof NodeSnapshotSchema>;

export type SnapshotTreeNode = NodeSnapshot & { children: SnapshotTreeNode[] };
export const SnapshotTreeNodeSchema: z.ZodType<SnapshotTreeNode> = NodeSnapshotSchema.extend({
  children: z.lazy(() => z.array(SnapshotTreeNodeSchema)),
});

export const TreeResultSchema = z.object({
  root: SnapshotTreeNodeSchema,
  nodeCount: z.number().int().positive(),
  truncated: z.boolean(),
});
export type TreeResult = z.infer<typeof TreeResultSchema>;

export const SelectionResultSchema = z.object({
  page: z.object({ id: z.string(), name: z.string() }),
  selection: z.array(NodeSummarySchema),
});

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
export type StatusResult = z.infer<typeof StatusResultSchema>;
