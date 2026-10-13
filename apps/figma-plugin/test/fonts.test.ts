import { afterEach, describe, expect, it, vi } from 'vitest';

import { listFonts } from '../src/main/handlers/fonts.js';

afterEach(() => vi.unstubAllGlobals());

describe('available font catalog', () => {
  it('按字体族过滤、去重、排序和分页，并聚合样式与轴', async () => {
    vi.stubGlobal('figma', {
      listAvailableFontsAsync: vi
        .fn()
        .mockResolvedValue([
          { fontName: { family: 'Inter', style: 'Regular' } },
          { fontName: { family: 'Inter', style: 'Bold' } },
          { fontName: { family: 'Inter', style: 'Regular' } },
          { fontName: { family: 'Roboto', style: 'Regular' } },
        ]),
      getFontFamilyVariationAxes: (family: string) => (family === 'Inter' ? ['wght'] : null),
    });

    await expect(listFonts({ familyFilter: 'int', cursor: 0, limit: 1 })).resolves.toEqual({
      families: [{ name: 'Inter', styles: ['Bold', 'Regular'], variationAxes: ['wght'] }],
    });
  });
});
