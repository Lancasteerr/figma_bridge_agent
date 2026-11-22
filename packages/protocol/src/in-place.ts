import { z } from 'zod';

import { CreateFrameInputSchema, SetLayoutInputSchema, UpdateTextInputSchema } from './tools.js';

/** Original artwork writes are a separate, explicit opt-in contract. */
export const InPlaceTargetSchema = z.object({
  scopeRootId: z.string().min(1),
  expectedFingerprint: z.string().min(8),
  editMode: z.literal('IN_PLACE'),
});

const targetless = { proposalRootId: true, expectedFingerprint: true } as const;
export const InPlaceOperationSchema = z.discriminatedUnion('type', [
  UpdateTextInputSchema.omit(targetless)
    .extend({ type: z.literal('TEXT') })
    .strict(),
  SetLayoutInputSchema.omit(targetless)
    .extend({ type: z.literal('LAYOUT') })
    .strict(),
  CreateFrameInputSchema.omit(targetless)
    .extend({ type: z.literal('CREATE_FRAME') })
    .strict(),
  z
    .object({
      type: z.literal('RESIZE'),
      nodeId: z.string().min(1),
      width: z.number().positive().max(100_000),
      height: z.number().positive().max(100_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('CAROUSEL'),
      parentId: z.string().min(1),
      name: z.string().min(1).max(200).default('Carousel'),
      assetIds: z.array(z.string().min(1)).min(1).max(20),
      width: z.number().positive().max(100_000),
      height: z.number().positive().max(100_000),
      x: z.number().default(0),
      y: z.number().default(0),
      gap: z.number().nonnegative().max(10_000).default(0),
    })
    .strict(),
]);

export const EditInPlaceInputSchema = InPlaceTargetSchema.extend({
  operations: z.array(InPlaceOperationSchema).min(1).max(100),
}).strict();
export const EditInPlaceResultSchema = z
  .object({
    scopeRootId: z.string(),
    treeFingerprint: z.string().min(8),
    createdNodeIds: z.array(z.string()),
  })
  .strict();
export const DeleteNodesInputSchema = InPlaceTargetSchema.extend({
  nodeIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'nodeIds must be unique.'),
}).strict();
export const DeleteNodesResultSchema = z
  .object({
    deletedNodeIds: z.array(z.string()),
    scopeRemoved: z.boolean(),
    treeFingerprint: z.string().min(8).nullable(),
  })
  .strict();
export type InPlaceOperation = z.infer<typeof InPlaceOperationSchema>;
