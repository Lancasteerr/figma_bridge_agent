import { DesignPlanSchema, type DesignFontName } from '@figma-agent/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

const markerMocks = vi.hoisted(() => ({
  markProposal: vi.fn(),
  markProposalBuilding: vi.fn(),
}));

vi.mock('../src/main/proposal/marker.js', () => markerMocks);

import { executeDesignPlan } from '../src/main/design-plan/executor.js';
import type { AppliedDesignResources } from '../src/main/design-plan/resources.js';
import type { ValidatedDesignSource } from '../src/main/design-plan/validator.js';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('DesignPlan text execution', () => {
  it('switches to the preloaded target font before writing font-sensitive properties', async () => {
    const fixture = installFigmaFixture();
    const regular = { family: 'Noto Sans SC', style: 'Regular' };
    const bold = { family: 'Noto Sans SC', style: 'Bold' };
    const source = validatedSource([
      ['body:base', regular],
      ['body:range:0', bold],
    ]);
    const plan = DesignPlanSchema.parse({
      version: 1,
      proposal: { name: 'Font order regression', offsetX: 0, offsetY: 0 },
      resources: [],
      root: {
        kind: 'FRAME',
        ref: 'page',
        name: 'Page',
        geometry: { width: 320, height: 180 },
        children: [
          {
            kind: 'TEXT',
            ref: 'body',
            name: 'Body',
            geometry: { width: 280, height: 80 },
            text: {
              characters: '测试文本',
              font: { requested: regular, fallbacks: [], policy: 'STRICT' },
              fontSize: 16,
              textAutoResize: 'HEIGHT',
              ranges: [
                {
                  start: 0,
                  end: 2,
                  font: { requested: bold, fallbacks: [], policy: 'STRICT' },
                  fontSize: 18,
                },
              ],
            },
          },
        ],
      },
    });

    const result = await executeDesignPlan(
      plan,
      source,
      emptyResources(),
      'operation-1',
      'a'.repeat(64),
    );

    expect(fixture.fontOperations.slice(0, 2)).toEqual([
      'fontName:Noto Sans SC Regular',
      'textAutoResize:NONE',
    ]);
    expect(fixture.text.fontName).toEqual(regular);
    expect(fixture.text.characters).toBe('测试文本');
    expect(fixture.text.textAutoResize).toBe('HEIGHT');
    expect(fixture.text.setRangeFontName).toHaveBeenCalledWith(0, 2, bold);
    expect(fixture.text.setRangeFontSize).toHaveBeenCalledWith(0, 2, 18);
    expect(result.refMap).toMatchObject({ page: fixture.root.id, body: fixture.text.id });
    expect(fixture.root.remove).not.toHaveBeenCalled();
    expect(fixture.root.visible).toBe(true);
    expect(markerMocks.markProposal).toHaveBeenCalledOnce();
    expect(
      (globalThis.figma as unknown as { loadFontAsync?: unknown }).loadFontAsync,
    ).toBeUndefined();
  });

  it('initializes a parent Auto Layout before applying child sizing', async () => {
    const fixture = installFigmaFixture();
    const regular = { family: 'Noto Sans SC', style: 'Regular' };
    const plan = DesignPlanSchema.parse({
      version: 1,
      proposal: { name: 'Auto Layout order regression', offsetX: 0, offsetY: 0 },
      resources: [],
      root: {
        kind: 'FRAME',
        ref: 'page',
        name: 'Page',
        geometry: { width: 320, height: 180 },
        children: [
          {
            kind: 'FRAME',
            ref: 'stack',
            name: 'Stack',
            geometry: { width: 280, height: 120 },
            layout: {
              mode: 'VERTICAL',
              wrap: 'NO_WRAP',
              gap: 8,
              padding: { top: 8, right: 8, bottom: 8, left: 8 },
            },
            children: [
              {
                kind: 'TEXT',
                ref: 'body',
                name: 'Body',
                geometry: { width: 264, height: 40 },
                placement: { sizing: { horizontal: 'FILL', vertical: 'HUG' } },
                text: {
                  characters: '自动布局文本',
                  font: { requested: regular, fallbacks: [], policy: 'STRICT' },
                  fontSize: 16,
                  textAutoResize: 'HEIGHT',
                },
              },
            ],
          },
        ],
      },
    });

    await executeDesignPlan(
      plan,
      validatedSource([['body:base', regular]]),
      emptyResources(),
      'operation-2',
      'b'.repeat(64),
    );

    expect(fixture.container.layoutMode).toBe('VERTICAL');
    expect(fixture.text.layoutSizingHorizontal).toBe('FILL');
    expect(fixture.text.layoutSizingVertical).toBe('HUG');
    expect(fixture.root.remove).not.toHaveBeenCalled();
  });
});

function installFigmaFixture(): {
  root: FakeFrame;
  container: FakeFrame;
  text: FakeText;
  fontOperations: string[];
} {
  const fontOperations: string[] = [];
  const loadedFonts = new Set(['Noto Sans SC\u0000Regular', 'Noto Sans SC\u0000Bold']);
  const root = frameNode('frame-1');
  const container = frameNode('frame-2');
  const text = textNode('text-1', loadedFonts, fontOperations);
  const frames = [root, container];
  const currentPage = {
    selection: [] as unknown[],
    appendChild: vi.fn((node: FakeFrame) => {
      node.parent = currentPage;
    }),
  };
  vi.stubGlobal('figma', {
    createFrame: vi.fn(() => {
      const frame = frames.shift();
      if (!frame) throw new Error('Unexpected Frame creation.');
      return frame;
    }),
    createText: vi.fn(() => text),
    currentPage,
    viewport: { scrollAndZoomIntoView: vi.fn() },
  });
  return { root, container, text, fontOperations };
}

function frameNode(id: string): FakeFrame {
  const node: FakeFrame = {
    id,
    type: 'FRAME',
    name: '',
    parent: null,
    children: [],
    removed: false,
    visible: true,
    fills: [],
    x: 0,
    y: 0,
    rotation: 0,
    layoutMode: 'NONE',
    resizeWithoutConstraints: vi.fn(),
    appendChild: vi.fn((child: FakeFrame | FakeText) => {
      node.children.push(child);
      child.parent = node;
    }),
    remove: vi.fn(() => {
      node.removed = true;
    }),
  };
  return node;
}

function textNode(id: string, loadedFonts: Set<string>, operations: string[]): FakeText {
  let currentFont: DesignFontName = { family: 'Inter', style: 'Regular' };
  let autoResize = 'WIDTH_AND_HEIGHT';
  let characters = '';
  let layoutSizingHorizontal = 'FIXED';
  let layoutSizingVertical = 'FIXED';
  const assertCurrentFontLoaded = (): void => {
    if (!loadedFonts.has(fontKey(currentFont))) {
      throw new Error(
        `Cannot write to node with unloaded font "${currentFont.family} ${currentFont.style}".`,
      );
    }
  };
  const node = {
    id,
    type: 'TEXT',
    name: '',
    parent: null,
    x: 0,
    y: 0,
    rotation: 0,
    fontSize: 12,
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { value: 0, unit: 'PIXELS' },
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    paragraphSpacing: 0,
    resizeWithoutConstraints: vi.fn(),
    setRangeFontName: vi.fn((start: number, end: number, font: DesignFontName) => {
      if (!loadedFonts.has(fontKey(font))) throw new Error('Range font is not loaded.');
      operations.push(`rangeFont:${start}:${end}:${font.family} ${font.style}`);
    }),
    setRangeFontSize: vi.fn(),
    setRangeLineHeight: vi.fn(),
    setRangeLetterSpacing: vi.fn(),
    setRangeFills: vi.fn(),
    setRangeTextCase: vi.fn(),
    setRangeTextDecoration: vi.fn(),
  } as unknown as FakeText;
  Object.defineProperties(node, {
    fontName: {
      get: () => currentFont,
      set: (font: DesignFontName) => {
        if (!loadedFonts.has(fontKey(font))) throw new Error('Target font is not loaded.');
        operations.push(`fontName:${font.family} ${font.style}`);
        currentFont = font;
      },
    },
    textAutoResize: {
      get: () => autoResize,
      set: (value: string) => {
        assertCurrentFontLoaded();
        operations.push(`textAutoResize:${value}`);
        autoResize = value;
      },
    },
    characters: {
      get: () => characters,
      set: (value: string) => {
        assertCurrentFontLoaded();
        operations.push('characters');
        characters = value;
      },
    },
    layoutSizingHorizontal: {
      get: () => layoutSizingHorizontal,
      set: (value: string) => {
        if ((node.parent as FakeFrame | null)?.layoutMode === 'NONE') {
          throw new Error('node must be an auto-layout frame or a child of an auto-layout frame');
        }
        layoutSizingHorizontal = value;
      },
    },
    layoutSizingVertical: {
      get: () => layoutSizingVertical,
      set: (value: string) => {
        if ((node.parent as FakeFrame | null)?.layoutMode === 'NONE') {
          throw new Error('node must be an auto-layout frame or a child of an auto-layout frame');
        }
        layoutSizingVertical = value;
      },
    },
  });
  return node;
}

function validatedSource(fonts: Array<[string, DesignFontName]>): ValidatedDesignSource {
  return {
    roots: [],
    cloneSources: new Map(),
    assets: new Map(),
    resolvedFonts: new Map(fonts),
    warnings: [],
    resources: {
      definitions: [],
      styles: new Map(),
      variables: new Map(),
      variableTypes: new Map(),
    },
    instanceSources: new Map(),
    existingStyles: new Map(),
    existingVariables: new Map(),
  };
}

function emptyResources(): AppliedDesignResources {
  return {
    styles: new Map(),
    variables: new Map(),
    resourceMap: {},
    commit: vi.fn(),
    rollback: vi.fn(),
  };
}

function fontKey(font: DesignFontName): string {
  return `${font.family}\u0000${font.style}`;
}

interface FakeFrame {
  id: string;
  type: 'FRAME';
  name: string;
  parent: unknown;
  children: Array<FakeFrame | FakeText>;
  removed: boolean;
  visible: boolean;
  fills: unknown[];
  x: number;
  y: number;
  rotation: number;
  layoutMode: string;
  resizeWithoutConstraints: ReturnType<typeof vi.fn>;
  appendChild: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

interface FakeText {
  id: string;
  type: 'TEXT';
  name: string;
  parent: unknown;
  x: number;
  y: number;
  rotation: number;
  fontName: DesignFontName;
  characters: string;
  textAutoResize: string;
  layoutSizingHorizontal: string;
  layoutSizingVertical: string;
  setRangeFontName: ReturnType<typeof vi.fn>;
  setRangeFontSize: ReturnType<typeof vi.fn>;
}
