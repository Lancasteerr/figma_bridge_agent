import { z } from 'zod';

import { AxisSizingSchema, PositioningSchema } from './node.js';

/** LayoutPlan 当前只允许写入这两种 Auto Layout 方向。 */
export const WritableLayoutModeSchema = z.enum(['HORIZONTAL', 'VERTICAL']);
/** 主轴对齐方式；SPACE_BETWEEN 由 Figma 的 Auto Layout 语义解释。 */
export const PrimaryAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']);
/** 交叉轴对齐方式不包含 SPACE_BETWEEN。 */
export const CounterAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX']);

/** 一个容器的可写布局参数，strict() 用于拒绝未支持的 GRID/WRAP 等扩展字段。 */
export const LayoutSpecSchema = z
  .object({
    mode: WritableLayoutModeSchema,
    gap: z.number().min(0).max(10_000).default(0),
    padding: z.object({
      top: z.number().min(0).max(10_000),
      right: z.number().min(0).max(10_000),
      bottom: z.number().min(0).max(10_000),
      left: z.number().min(0).max(10_000),
    }),
    primaryAxisAlign: PrimaryAxisAlignSchema.default('MIN'),
    counterAxisAlign: CounterAxisAlignSchema.default('MIN'),
  })
  .strict();
/** 经过校验、可直接应用到 Figma 容器的布局配置。 */
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

/** 节点已经存在时，计划只描述其放置方式，不复制节点结构。 */
export const SizingSpecSchema = z.object({
  horizontal: AxisSizingSchema.optional(),
  vertical: AxisSizingSchema.optional(),
});
/** 水平和垂直方向可以独立选择 FIXED/HUG/FILL。 */
export type SizingSpec = z.infer<typeof SizingSpecSchema>;

/** 计划中的已有节点引用；sourceNodeId 必须来自源指纹覆盖的节点集合。 */
export interface ExistingLayoutItem {
  kind: 'existing';
  sourceNodeId: string;
  positioning?: z.infer<typeof PositioningSchema> | undefined;
  sizing?: SizingSpec | undefined;
  absolute?: { x: number; y: number } | undefined;
}

/** 计划中的新 Frame；children 递归描述新建容器和已有节点的组合。 */
export interface FrameLayoutItem {
  kind: 'frame';
  ref: string;
  name: string;
  layout: LayoutSpec;
  sizing?: SizingSpec | undefined;
  children: LayoutItem[];
}

/** 递归布局项的联合类型。 */
export type LayoutItem = ExistingLayoutItem | FrameLayoutItem;

export const ExistingLayoutItemSchema: z.ZodType<ExistingLayoutItem> = z.object({
  kind: z.literal('existing'),
  sourceNodeId: z.string().min(1),
  positioning: PositioningSchema.optional(),
  sizing: SizingSpecSchema.optional(),
  absolute: z.object({ x: z.number(), y: z.number() }).optional(),
});

/** 新 Frame 至少需要一个子项，避免生成没有内容的空容器。 */
export const FrameLayoutItemSchema: z.ZodType<FrameLayoutItem> = z.object({
  kind: z.literal('frame'),
  ref: z.string().min(1),
  name: z.string().min(1),
  layout: LayoutSpecSchema,
  sizing: SizingSpecSchema.optional(),
  children: z.lazy(() => z.array(LayoutItemSchema).min(1)),
});

/** lazy() 让 FrameLayoutItem.children 可以引用自身，形成受 schema 约束的树。 */
export const LayoutItemSchema: z.ZodType<LayoutItem> = z.lazy(() =>
  z.union([ExistingLayoutItemSchema, FrameLayoutItemSchema]),
);

const RootFieldsSchema = z.object({
  name: z.string().min(1),
  layout: LayoutSpecSchema,
  sizing: SizingSpecSchema.optional(),
  children: z.array(LayoutItemSchema).min(1),
});

/** 根节点可以复用已有容器，也可以从新 Frame 开始。 */
export const LayoutPlanRootSchema = z.discriminatedUnion('kind', [
  RootFieldsSchema.extend({
    kind: z.literal('existing-container'),
    sourceNodeId: z.string().min(1),
  }),
  RootFieldsSchema.extend({ kind: z.literal('new-frame') }),
]);

/**
 * 布局计划把源节点指纹、Proposal 偏移和声明式布局组合起来。
 * 应用阶段会再次核对 source.fingerprint，避免基于过期文档执行修改。
 */
export const LayoutPlanSchema = z.object({
  version: z.literal(1),
  source: z.object({
    rootNodeIds: z.array(z.string().min(1)).min(1),
    fingerprint: z.string().min(8),
  }),
  proposal: z.object({
    nameSuffix: z.string().default(' / Agent Proposal'),
    offsetX: z.number().default(64),
    offsetY: z.number().default(0),
  }),
  root: LayoutPlanRootSchema,
  convertToComponent: z.boolean().default(false),
});
/** LayoutPlan v1 的完整输入类型。 */
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;

/** 验证阶段返回的非致命提示，可关联到具体节点。 */
export const LayoutPlanWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
});

/** 验证结果中的 validationId 是一次性、短时有效的应用凭证。 */
export const LayoutPlanValidationResultSchema = z.object({
  valid: z.boolean(),
  validationId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  warnings: z.array(LayoutPlanWarningSchema),
});
/** 布局计划验证阶段的公开结果类型。 */
export type LayoutPlanValidationResult = z.infer<typeof LayoutPlanValidationResultSchema>;

/** 应用计划后返回 Proposal 根节点、克隆映射和最终指纹。 */
export const LayoutPlanApplyResultSchema = z.object({
  proposalRootId: z.string(),
  idMap: z.record(z.string(), z.string()),
  fingerprint: z.string(),
  componentId: z.string().optional(),
});
/** 布局计划执行阶段的公开结果类型。 */
export type LayoutPlanApplyResult = z.infer<typeof LayoutPlanApplyResultSchema>;
