import { z } from 'zod';

export const SupportedAssetMimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
]);
export type SupportedAssetMime = z.infer<typeof SupportedAssetMimeSchema>;

export const StageAssetInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    mimeType: SupportedAssetMimeSchema,
    dataBase64: z.string().min(1),
  })
  .strict();

export const StagedAssetResultSchema = z.object({
  assetId: z.string().uuid(),
  kind: z.enum(['RASTER', 'SVG']),
  mimeType: SupportedAssetMimeSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  expiresAt: z.string().datetime(),
});
export type StagedAssetResult = z.infer<typeof StagedAssetResultSchema>;

/** MCP Server 完成安全校验后才允许构造这个内部 RPC 输入。 */
export const StageAssetRpcInputSchema = StagedAssetResultSchema.omit({ expiresAt: true }).extend({
  name: z.string().min(1).max(200),
  dataBase64: z.string().optional(),
  svgText: z.string().optional(),
});
export type StageAssetRpcInput = z.infer<typeof StageAssetRpcInputSchema>;

export const DesignAssetRefSchema = z
  .object({
    assetId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type DesignAssetRef = z.infer<typeof DesignAssetRefSchema>;
