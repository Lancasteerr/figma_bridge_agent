import { z } from 'zod';

import { LayoutPlanSchema, LayoutSpecSchema, SizingSpecSchema } from './layout-plan.js';
import { PositioningSchema } from './node.js';

export const EmptyInputSchema = z.object({});
export const GetNodeInputSchema = z.object({ nodeId: z.string().min(1) });
export const GetTreeInputSchema = z.object({
  nodeId: z.string().min(1),
  depth: z.number().int().min(0).max(8).default(2),
  maxNodes: z.number().int().min(1).max(1000).default(200),
  maxTextLength: z.number().int().min(0).max(10_000).default(2_000),
});
export const RenderNodeInputSchema = z.object({
  nodeId: z.string().min(1),
  scale: z.number().positive().max(4).default(1),
  maxDimension: z.number().int().min(64).max(2048).default(2048),
});
export const GetCssInputSchema = GetNodeInputSchema;
export const GetRawNodeInputSchema = GetNodeInputSchema.extend({
  maxBytes: z.number().int().min(1_024).max(8 * 1024 * 1024).default(2 * 1024 * 1024),
});
export const GetVariablesInputSchema = z.object({
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(1_000).default(200),
});
export const ExportAssetInputSchema = z.object({
  nodeId: z.string().min(1),
  format: z.enum(['PNG', 'SVG']),
  scale: z.number().positive().max(4).default(1),
});

export const DuplicateProposalInputSchema = z.object({
  nodeIds: z.array(z.string().min(1)).min(1).optional(),
  nameSuffix: z.string().min(1).max(100).default(' / Agent Proposal'),
  offsetX: z.number().default(64),
  offsetY: z.number().default(0),
});
export const ProposalTargetSchema = z.object({
  proposalRootId: z.string().min(1),
  expectedFingerprint: z.string().min(8).optional(),
});
export const CreateFrameInputSchema = ProposalTargetSchema.extend({
  parentId: z.string().min(1),
  name: z.string().min(1).max(200),
  index: z.number().int().nonnegative().optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive().default(100),
  height: z.number().positive().default(100),
});
export const ReparentNodesInputSchema = ProposalTargetSchema.extend({
  nodeIds: z.array(z.string().min(1)).min(1),
  parentId: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
  placement: z.enum(['FLOW', 'ABSOLUTE']),
  preserveAbsolutePosition: z.boolean().default(true),
});
export const SetLayoutInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
  layout: LayoutSpecSchema.optional(),
  sizing: SizingSpecSchema.optional(),
  positioning: PositioningSchema.optional(),
  absolute: z.object({ x: z.number(), y: z.number() }).optional(),
});
export const UpdateTextInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
  characters: z.string().optional(),
  fontName: z.object({ family: z.string(), style: z.string() }).optional(),
  fontSize: z.number().positive().optional(),
  lineHeight: z.number().positive().optional(),
});
export const SetInstancePropertiesInputSchema = ProposalTargetSchema.extend({
  nodeId: z.string().min(1),
  properties: z.record(z.string(), z.union([z.string(), z.boolean()])),
});
export const CreateComponentInputSchema = ProposalTargetSchema.extend({ nodeId: z.string().min(1) });
export const DiscardProposalInputSchema = z.object({
  proposalRootId: z.string().min(1),
  expectedFingerprint: z.string().min(8),
});
export const ValidateLayoutPlanInputSchema = z.object({ plan: LayoutPlanSchema });
export const ApplyLayoutPlanInputSchema = z.object({ validationId: z.string().min(1) });

export const RenderResultSchema = z.object({
  nodeId: z.string(),
  mimeType: z.literal('image/png'),
  data: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  fingerprint: z.string(),
});

export const ExportResultSchema = z.object({
  nodeId: z.string(),
  format: z.enum(['PNG', 'SVG']),
  mimeType: z.string(),
  data: z.string(),
  encoding: z.enum(['base64', 'utf8']),
  suggestedName: z.string(),
  fingerprint: z.string(),
});

