import { z } from 'zod';

import { LayoutSpecSchema, SizingSpecSchema } from './layout.js';
import { PositioningSchema } from './node.js';

export const DESIGN_PLAN_MAX_NODES = 1_000;
export const DESIGN_PLAN_MAX_DEPTH = 32;

/** 基础几何在后续版本中继续扩展；默认值保证最小计划也可执行。 */
export const DesignGeometrySchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().positive().max(100_000).default(100),
    height: z.number().positive().max(100_000).default(100),
    rotation: z.number().min(-360).max(360).default(0),
  })
  .strict();

export const DesignPlacementSchema = z
  .object({
    sizing: SizingSpecSchema.optional(),
    positioning: PositioningSchema.optional(),
  })
  .strict();
export type DesignPlacement = z.infer<typeof DesignPlacementSchema>;

export interface ContainerDesignNode {
  kind: 'FRAME';
  ref: string;
  name: string;
  geometry: z.infer<typeof DesignGeometrySchema>;
  layout?: z.infer<typeof LayoutSpecSchema> | undefined;
  placement?: z.infer<typeof DesignPlacementSchema> | undefined;
  children: DesignNode[];
}

export interface PrimitiveDesignNode {
  kind: 'RECTANGLE' | 'ELLIPSE' | 'LINE';
  ref: string;
  name: string;
  geometry: z.infer<typeof DesignGeometrySchema>;
  placement?: z.infer<typeof DesignPlacementSchema> | undefined;
}

export interface CloneDesignNode {
  kind: 'CLONE';
  ref: string;
  name?: string | undefined;
  sourceNodeId: string;
  geometry?: z.infer<typeof DesignGeometrySchema> | undefined;
  placement?: z.infer<typeof DesignPlacementSchema> | undefined;
}

export type DesignNode = ContainerDesignNode | PrimitiveDesignNode | CloneDesignNode;

const CommonNodeFields = {
  ref: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  geometry: DesignGeometrySchema,
};

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('FRAME'),
        ...CommonNodeFields,
        layout: LayoutSpecSchema.optional(),
        placement: DesignPlacementSchema.optional(),
        children: z.array(DesignNodeSchema),
      })
      .strict(),
    z
      .object({
        kind: z.enum(['RECTANGLE', 'ELLIPSE', 'LINE']),
        ...CommonNodeFields,
        placement: DesignPlacementSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('CLONE'),
        ref: z.string().min(1).max(200),
        name: z.string().min(1).max(200).optional(),
        sourceNodeId: z.string().min(1),
        geometry: DesignGeometrySchema.optional(),
        placement: DesignPlacementSchema.optional(),
      })
      .strict(),
  ]),
);

/** 根节点固定为 Frame，保证 Proposal 总有明确、可审查的边界。 */
export const DesignFrameNodeSchema = DesignNodeSchema.refine(
  (node): node is ContainerDesignNode => node.kind === 'FRAME',
  'DesignPlan root must be a FRAME.',
);

export const DesignPlanSchema = z
  .object({
    version: z.literal(1),
    source: z
      .object({
        rootNodeIds: z.array(z.string().min(1)).min(1),
        fingerprint: z.string().min(8),
      })
      .strict()
      .optional(),
    proposal: z
      .object({
        name: z.string().min(1).max(200),
        offsetX: z.number().default(64),
        offsetY: z.number().default(0),
      })
      .strict(),
    root: DesignFrameNodeSchema,
  })
  .strict();
export type DesignPlan = z.infer<typeof DesignPlanSchema>;

export const DesignPlanWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  ref: z.string().optional(),
  nodeId: z.string().optional(),
});

export const DesignPlanValidationResultSchema = z.object({
  valid: z.boolean(),
  validationId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  warnings: z.array(DesignPlanWarningSchema),
});
export type DesignPlanValidationResult = z.infer<typeof DesignPlanValidationResultSchema>;

export const DesignPlanApplyResultSchema = z.object({
  proposalRootId: z.string(),
  refMap: z.record(z.string(), z.string()),
  resourceMap: z.record(z.string(), z.string()),
  fingerprint: z.string(),
});
export type DesignPlanApplyResult = z.infer<typeof DesignPlanApplyResultSchema>;
