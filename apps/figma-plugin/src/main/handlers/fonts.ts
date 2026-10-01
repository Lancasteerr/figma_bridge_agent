import {
  FontCatalogResultSchema,
  ListFontsInputSchema,
  type FontCatalogResult,
} from '@figma-agent/protocol';

/** 返回稳定排序、去重且分页的当前 Figma 可用字体目录。 */
export async function listFonts(params: unknown): Promise<FontCatalogResult> {
  const input = ListFontsInputSchema.parse(params);
  const filter = input.familyFilter?.toLocaleLowerCase();
  const all = await figma.listAvailableFontsAsync();
  const families = new Map<string, string[]>();
  const unique = new Map<string, { family: string; style: string }>();
  for (const font of all) {
    const { family, style } = font.fontName;
    if (filter && !family.toLocaleLowerCase().includes(filter)) continue;
    unique.set(`${family}\u0000${style}`, { family, style });
    if (!families.has(family)) families.set(family, figma.getFontFamilyVariationAxes(family) ?? []);
  }
  const fonts = [...unique.values()]
    .sort((left, right) => compare(left.family, right.family) || compare(left.style, right.style))
    .map((font) => ({ ...font, variationAxes: families.get(font.family) ?? [] }));
  const page = fonts.slice(input.cursor, input.cursor + input.limit);
  const next = input.cursor + page.length;
  return FontCatalogResultSchema.parse({
    cursor: input.cursor,
    ...(next < fonts.length ? { nextCursor: next } : {}),
    total: fonts.length,
    fonts: page,
  });
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
