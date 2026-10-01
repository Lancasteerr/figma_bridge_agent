import { z } from 'zod';

export const ListFontsInputSchema = z
  .object({
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(1_000).default(200),
    familyFilter: z.string().min(1).max(200).optional(),
  })
  .strict();

export const FontCatalogEntrySchema = z.object({
  family: z.string(),
  style: z.string(),
  variationAxes: z.array(z.string()),
});

export const FontCatalogResultSchema = z.object({
  cursor: z.number().int().nonnegative(),
  nextCursor: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative(),
  fonts: z.array(FontCatalogEntrySchema),
});
export type FontCatalogResult = z.infer<typeof FontCatalogResultSchema>;
