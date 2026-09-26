import { z } from 'zod';

import { AxisSizingSchema, PositioningSchema } from './node.js';

export const WritableLayoutModeSchema = z.enum(['HORIZONTAL', 'VERTICAL']);
export const PrimaryAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']);
export const CounterAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX']);

export const LayoutSpecSchema = z.object({
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
});
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

export const SizingSpecSchema = z.object({
  horizontal: AxisSizingSchema.optional(),
  vertical: AxisSizingSchema.optional(),
});
export type SizingSpec = z.infer<typeof SizingSpecSchema>;

export interface ExistingLayoutItem {
  kind: 'existing';
  sourceNodeId: string;
  positioning?: z.infer<typeof PositioningSchema> | undefined;
  sizing?: SizingSpec | undefined;
  absolute?: { x: number; y: number } | undefined;
}

export interface FrameLayoutItem {
  kind: 'frame';
  ref: string;
  name: string;
  layout: LayoutSpec;
  sizing?: SizingSpec | undefined;
  children: LayoutItem[];
}

export type LayoutItem = ExistingLayoutItem | FrameLayoutItem;

export const ExistingLayoutItemSchema: z.ZodType<ExistingLayoutItem> = z.object({
  kind: z.literal('existing'),
  sourceNodeId: z.string().min(1),
  positioning: PositioningSchema.optional(),
  sizing: SizingSpecSchema.optional(),
  absolute: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const FrameLayoutItemSchema: z.ZodType<FrameLayoutItem> = z.object({
  kind: z.literal('frame'),
  ref: z.string().min(1),
  name: z.string().min(1),
  layout: LayoutSpecSchema,
  sizing: SizingSpecSchema.optional(),
  children: z.lazy(() => z.array(LayoutItemSchema).min(1)),
});

export const LayoutItemSchema: z.ZodType<LayoutItem> = z.lazy(() =>
  z.union([ExistingLayoutItemSchema, FrameLayoutItemSchema]),
);

const RootFieldsSchema = z.object({
  name: z.string().min(1),
  layout: LayoutSpecSchema,
  sizing: SizingSpecSchema.optional(),
  children: z.array(LayoutItemSchema).min(1),
});

export const LayoutPlanRootSchema = z.discriminatedUnion('kind', [
  RootFieldsSchema.extend({
    kind: z.literal('existing-container'),
    sourceNodeId: z.string().min(1),
  }),
  RootFieldsSchema.extend({ kind: z.literal('new-frame') }),
]);

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
export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;

export const LayoutPlanWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
});

export const LayoutPlanValidationResultSchema = z.object({
  valid: z.boolean(),
  validationId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  warnings: z.array(LayoutPlanWarningSchema),
});
export type LayoutPlanValidationResult = z.infer<typeof LayoutPlanValidationResultSchema>;

export const LayoutPlanApplyResultSchema = z.object({
  proposalRootId: z.string(),
  idMap: z.record(z.string(), z.string()),
  fingerprint: z.string(),
  componentId: z.string().optional(),
});
export type LayoutPlanApplyResult = z.infer<typeof LayoutPlanApplyResultSchema>;
