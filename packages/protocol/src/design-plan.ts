import { z } from 'zod';

import { LayoutSpecSchema, SizingSpecSchema } from './layout.js';
import { PositioningSchema } from './node.js';

export const DESIGN_PLAN_MAX_NODES = 1_000;
export const DESIGN_PLAN_MAX_DEPTH = 32;

const UnitIntervalSchema = z.number().min(0).max(1);
export const ColorSchema = z
  .object({ r: UnitIntervalSchema, g: UnitIntervalSchema, b: UnitIntervalSchema })
  .strict();
export const RgbaSchema = ColorSchema.extend({ a: UnitIntervalSchema }).strict();
export const VectorSchema = z.object({ x: z.number(), y: z.number() }).strict();
export const TransformSchema = z.tuple([
  z.tuple([z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]),
]);

export const BlendModeSchema = z.enum([
  'PASS_THROUGH',
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'LINEAR_BURN',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'LINEAR_DODGE',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY',
]);

export const SolidPaintSchema = z
  .object({
    type: z.literal('SOLID'),
    color: ColorSchema,
    opacity: UnitIntervalSchema.default(1),
    visible: z.boolean().default(true),
    blendMode: BlendModeSchema.default('NORMAL'),
  })
  .strict();
export const GradientPaintSchema = z
  .object({
    type: z.enum(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']),
    gradientTransform: TransformSchema,
    gradientStops: z
      .array(z.object({ position: UnitIntervalSchema, color: RgbaSchema }).strict())
      .min(2),
    opacity: UnitIntervalSchema.default(1),
    visible: z.boolean().default(true),
    blendMode: BlendModeSchema.default('NORMAL'),
  })
  .strict();
export const DesignPaintSchema = z.discriminatedUnion('type', [
  SolidPaintSchema,
  GradientPaintSchema,
]);
export type DesignPaint = z.infer<typeof DesignPaintSchema>;

const ShadowEffectSchema = z
  .object({
    type: z.enum(['DROP_SHADOW', 'INNER_SHADOW']),
    color: RgbaSchema,
    offset: VectorSchema,
    radius: z.number().nonnegative(),
    spread: z.number().default(0),
    visible: z.boolean().default(true),
    blendMode: BlendModeSchema.default('NORMAL'),
  })
  .strict();
const BlurEffectSchema = z
  .object({
    type: z.enum(['LAYER_BLUR', 'BACKGROUND_BLUR']),
    radius: z.number().nonnegative(),
    visible: z.boolean().default(true),
  })
  .strict();
export const DesignEffectSchema = z.union([ShadowEffectSchema, BlurEffectSchema]);
export type DesignEffect = z.infer<typeof DesignEffectSchema>;

export const CornerRadiusSchema = z.union([
  z.number().nonnegative(),
  z
    .object({
      topLeft: z.number().nonnegative(),
      topRight: z.number().nonnegative(),
      bottomRight: z.number().nonnegative(),
      bottomLeft: z.number().nonnegative(),
    })
    .strict(),
]);

export const DesignVisualSchema = z
  .object({
    fills: z.array(DesignPaintSchema).optional(),
    strokes: z.array(DesignPaintSchema).optional(),
    strokeWeight: z.number().nonnegative().optional(),
    strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional(),
    dashPattern: z.array(z.number().nonnegative()).optional(),
    cornerRadius: CornerRadiusSchema.optional(),
    opacity: UnitIntervalSchema.optional(),
    blendMode: BlendModeSchema.optional(),
    effects: z.array(DesignEffectSchema).optional(),
  })
  .strict();
export type DesignVisual = z.infer<typeof DesignVisualSchema>;

export const ConstraintsSchema = z
  .object({
    horizontal: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']),
    vertical: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']),
  })
  .strict();

/** 几何边界同时限制错误计划和 Figma 中不可审查的超大节点。 */
export const DesignGeometrySchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().positive().max(100_000).default(100),
    height: z.number().positive().max(100_000).default(100),
    rotation: z.number().min(-360).max(360).default(0),
    minWidth: z.number().positive().nullable().optional(),
    maxWidth: z.number().positive().nullable().optional(),
    minHeight: z.number().positive().nullable().optional(),
    maxHeight: z.number().positive().nullable().optional(),
    constraints: ConstraintsSchema.optional(),
  })
  .strict();
export type DesignGeometry = z.infer<typeof DesignGeometrySchema>;

export const DesignPlacementSchema = z
  .object({
    sizing: SizingSpecSchema.optional(),
    positioning: PositioningSchema.optional(),
    layoutGrow: z.number().min(0).max(1).optional(),
    layoutAlign: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT']).optional(),
  })
  .strict();
export type DesignPlacement = z.infer<typeof DesignPlacementSchema>;

export const FontNameSchema = z
  .object({
    family: z.string().min(1),
    style: z.string().min(1),
    variationSettings: z.record(z.string().length(4), z.number()).optional(),
  })
  .strict();
export type DesignFontName = z.infer<typeof FontNameSchema>;

export const FontSelectionSchema = z
  .object({
    requested: FontNameSchema,
    fallbacks: z.array(FontNameSchema).default([]),
    policy: z.enum(['STRICT', 'ALLOW_FALLBACK']).default('STRICT'),
  })
  .strict();

export const LineHeightSchema = z.union([
  z.object({ unit: z.literal('AUTO') }).strict(),
  z
    .object({
      unit: z.enum(['PIXELS', 'PERCENT']),
      value: z.number().positive(),
    })
    .strict(),
]);
export const LetterSpacingSchema = z
  .object({ value: z.number(), unit: z.enum(['PIXELS', 'PERCENT']) })
  .strict();

const TextStyleFields = {
  font: FontSelectionSchema.optional(),
  fontSize: z.number().positive().optional(),
  lineHeight: LineHeightSchema.optional(),
  letterSpacing: LetterSpacingSchema.optional(),
  fills: z.array(DesignPaintSchema).optional(),
  textCase: z.enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE']).optional(),
  textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
};

export const TextRangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    ...TextStyleFields,
  })
  .strict();

export const DesignTextSchema = z
  .object({
    characters: z.string(),
    font: FontSelectionSchema,
    fontSize: z.number().positive().default(12),
    lineHeight: LineHeightSchema.default({ unit: 'AUTO' }),
    letterSpacing: LetterSpacingSchema.default({ value: 0, unit: 'PIXELS' }),
    textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).default('LEFT'),
    textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']).default('TOP'),
    textAutoResize: z.enum(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE']).default('NONE'),
    textCase: z.enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE']).default('ORIGINAL'),
    textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).default('NONE'),
    paragraphSpacing: z.number().nonnegative().default(0),
    ranges: z.array(TextRangeSchema).default([]),
  })
  .strict();
export type DesignText = z.infer<typeof DesignTextSchema>;

interface CommonDesignNode {
  ref: string;
  name: string;
  geometry: DesignGeometry;
  placement?: DesignPlacement | undefined;
  visual?: DesignVisual | undefined;
}

export interface ContainerDesignNode extends CommonDesignNode {
  kind: 'FRAME';
  layout?: z.infer<typeof LayoutSpecSchema> | undefined;
  clipsContent?: boolean | undefined;
  children: DesignNode[];
}

export interface PrimitiveDesignNode extends CommonDesignNode {
  kind: 'RECTANGLE' | 'ELLIPSE' | 'LINE';
}

export interface TextDesignNode extends CommonDesignNode {
  kind: 'TEXT';
  text: DesignText;
}

export interface CloneDesignNode {
  kind: 'CLONE';
  ref: string;
  name?: string | undefined;
  sourceNodeId: string;
  geometry?: DesignGeometry | undefined;
  placement?: DesignPlacement | undefined;
}

export type DesignNode =
  ContainerDesignNode | PrimitiveDesignNode | TextDesignNode | CloneDesignNode;

const CommonNodeFields = {
  ref: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  geometry: DesignGeometrySchema,
  placement: DesignPlacementSchema.optional(),
  visual: DesignVisualSchema.optional(),
};

export const DesignNodeSchema: z.ZodType<DesignNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('FRAME'),
        ...CommonNodeFields,
        layout: LayoutSpecSchema.optional(),
        clipsContent: z.boolean().optional(),
        children: z.array(DesignNodeSchema),
      })
      .strict(),
    z
      .object({
        kind: z.enum(['RECTANGLE', 'ELLIPSE', 'LINE']),
        ...CommonNodeFields,
      })
      .strict(),
    z
      .object({
        kind: z.literal('TEXT'),
        ...CommonNodeFields,
        text: DesignTextSchema,
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
export type DesignPlanWarning = z.infer<typeof DesignPlanWarningSchema>;

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
