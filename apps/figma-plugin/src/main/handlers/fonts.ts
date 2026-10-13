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
  const families = new Map<string, Set<string>>();
  for (const font of all) {
    const { family, style } = font.fontName;
    if (filter && !family.toLocaleLowerCase().includes(filter)) continue;
    const styles = families.get(family) ?? new Set<string>();
    styles.add(style);
    families.set(family, styles);
  }
  const entries = [...families.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([name, styles]) => {
      const variationAxes = figma.getFontFamilyVariationAxes(name) ?? [];
      return {
        name,
        styles: [...styles].sort(compare),
        ...(variationAxes.length > 0 ? { variationAxes } : {}),
      };
    });
  const page = entries.slice(input.cursor, input.cursor + input.limit);
  const next = input.cursor + page.length;
  return FontCatalogResultSchema.parse({
    ...(next < entries.length ? { nextCursor: next } : {}),
    families: page,
  });
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
