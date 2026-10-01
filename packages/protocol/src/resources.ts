import { z } from 'zod';

/** 资源目录只覆盖本地定义和当前页实际可见的组件，不暴露团队库 key。 */
export const GetDesignResourcesInputSchema = z
  .object({
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(1_000).default(200),
  })
  .strict();

const StyleResourceSchema = z
  .object({
    kind: z.literal('STYLE'),
    id: z.string(),
    name: z.string(),
    styleType: z.enum(['PAINT', 'TEXT', 'EFFECT', 'GRID']),
    usedOnCurrentPage: z.boolean(),
    definition: z.unknown(),
  })
  .strict();

const VariableCollectionResourceSchema = z
  .object({
    kind: z.literal('VARIABLE_COLLECTION'),
    id: z.string(),
    name: z.string(),
    defaultModeId: z.string(),
    modes: z.array(z.object({ modeId: z.string(), name: z.string() })),
    variableIds: z.array(z.string()),
  })
  .strict();

const VariableResourceSchema = z
  .object({
    kind: z.literal('VARIABLE'),
    id: z.string(),
    name: z.string(),
    collectionId: z.string(),
    resolvedType: z.enum(['COLOR', 'FLOAT', 'STRING', 'BOOLEAN', 'EASING', 'TIMING']),
    valuesByMode: z.unknown(),
    scopes: z.array(z.string()),
  })
  .strict();

const ComponentResourceSchema = z
  .object({
    kind: z.literal('COMPONENT'),
    nodeId: z.string(),
    name: z.string(),
    nodeType: z.enum(['COMPONENT', 'COMPONENT_SET', 'INSTANCE']),
    reusableBy: z.array(z.enum(['CREATE_INSTANCE', 'CLONE_INSTANCE'])),
    mainComponentId: z.string().optional(),
    properties: z.unknown().optional(),
  })
  .strict();

export const DesignResourceItemSchema = z.discriminatedUnion('kind', [
  StyleResourceSchema,
  VariableCollectionResourceSchema,
  VariableResourceSchema,
  ComponentResourceSchema,
]);
export type DesignResourceItem = z.infer<typeof DesignResourceItemSchema>;

export const DesignResourcesResultSchema = z
  .object({
    cursor: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative(),
    scannedNodeCount: z.number().int().nonnegative(),
    scanTruncated: z.boolean(),
    resources: z.array(DesignResourceItemSchema),
  })
  .strict();
export type DesignResourcesResult = z.infer<typeof DesignResourcesResultSchema>;
