import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateDesignPlan } from '../src/main/design-plan/validator.js';

afterEach(() => vi.unstubAllGlobals());

describe('DesignPlan font and text validation', () => {
  it('uses only an explicitly declared fallback', async () => {
    vi.stubGlobal('figma', {
      listAvailableFontsAsync: vi
        .fn()
        .mockResolvedValue([{ fontName: { family: 'Inter', style: 'Regular' } }]),
    });

    const result = await validateDesignPlan(textPlan());

    expect(result.resolvedFonts.get('title:base')).toEqual({
      family: 'Inter',
      style: 'Regular',
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'FONT_FALLBACK', ref: 'title' }),
    ]);
  });

  it('rejects text ranges beyond the character count', async () => {
    vi.stubGlobal('figma', {
      listAvailableFontsAsync: vi
        .fn()
        .mockResolvedValue([{ fontName: { family: 'Inter', style: 'Regular' } }]),
    });
    const plan = textPlan();
    plan.root.children[0]!.text.ranges = [{ start: 0, end: 99, fontSize: 20 }];

    await expect(validateDesignPlan(plan)).rejects.toMatchObject({
      bridgeError: { code: 'PLAN_INVALID' },
    });
  });
});

function textPlan() {
  return {
    version: 1 as const,
    proposal: { name: 'Page', offsetX: 0, offsetY: 0 },
    root: {
      kind: 'FRAME' as const,
      ref: 'page',
      name: 'Page',
      geometry: { x: 0, y: 0, width: 1440, height: 900, rotation: 0 },
      children: [
        {
          kind: 'TEXT' as const,
          ref: 'title',
          name: 'Title',
          geometry: { x: 0, y: 0, width: 600, height: 80, rotation: 0 },
          text: {
            characters: 'Hello',
            font: {
              requested: { family: 'Missing', style: 'Bold' },
              fallbacks: [{ family: 'Inter', style: 'Regular' }],
              policy: 'ALLOW_FALLBACK' as const,
            },
            fontSize: 32,
            lineHeight: { unit: 'AUTO' as const },
            letterSpacing: { value: 0, unit: 'PIXELS' as const },
            textAlignHorizontal: 'LEFT' as const,
            textAlignVertical: 'TOP' as const,
            textAutoResize: 'HEIGHT' as const,
            textCase: 'ORIGINAL' as const,
            textDecoration: 'NONE' as const,
            paragraphSpacing: 0,
            ranges: [] as Array<{ start: number; end: number; fontSize?: number }>,
          },
        },
      ],
    },
  };
}
