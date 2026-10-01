import { afterEach, describe, expect, it, vi } from 'vitest';

import { listFonts } from '../src/main/handlers/fonts.js';

afterEach(() => vi.unstubAllGlobals());

describe('available font catalog', () => {
  it('filters, deduplicates, sorts, and paginates fonts with axes', async () => {
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
      cursor: 0,
      nextCursor: 1,
      total: 2,
      fonts: [{ family: 'Inter', style: 'Bold', variationAxes: ['wght'] }],
    });
  });
});
