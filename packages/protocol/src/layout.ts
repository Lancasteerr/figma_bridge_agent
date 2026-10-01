import { z } from 'zod';

import { AxisSizingSchema } from './node.js';

/** 当前公开写接口支持的 Auto Layout 方向。 */
export const WritableLayoutModeSchema = z.enum(['HORIZONTAL', 'VERTICAL']);
export const PrimaryAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']);
export const CounterAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX']);

/** 普通 Proposal 修改工具和 DesignPlan 共用的基础布局结构。 */
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
export type LayoutSpec = z.infer<typeof LayoutSpecSchema>;

export const SizingSpecSchema = z.object({
  horizontal: AxisSizingSchema.optional(),
  vertical: AxisSizingSchema.optional(),
});
export type SizingSpec = z.infer<typeof SizingSpecSchema>;
