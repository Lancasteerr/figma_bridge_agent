import { z } from 'zod';

export const ListFontsInputSchema = z
  .object({
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(1_000).default(200),
    familyFilter: z.string().min(1).max(200).optional(),
  })
  .strict();

/** 字体按 family 聚合，避免每个 style 重复携带相同的可变轴。 */
export const FontFamilyEntrySchema = z
  .object({
    name: z.string(),
    styles: z.array(z.string()).min(1),
    variationAxes: z.array(z.string()).min(1).optional(),
  })
  .strict();

export const FontCatalogResultSchema = z
  .object({
    nextCursor: z.number().int().nonnegative().optional(),
    families: z.array(FontFamilyEntrySchema),
  })
  .strict();
export type FontCatalogResult = z.infer<typeof FontCatalogResultSchema>;
