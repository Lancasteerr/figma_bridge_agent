import {
  BridgeFault,
  DESIGN_PLAN_MAX_DEPTH,
  DESIGN_PLAN_MAX_NODES,
  type DesignFontName,
  type DesignNode,
  type DesignPlan,
  type DesignPlanWarning,
} from '@figma-agent/protocol';

import { isInside } from '../proposal/marker.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { assetCache, type StagedAssetEntry } from '../assets/asset-cache.js';

export interface ValidatedDesignSource {
  roots: SceneNode[];
  cloneSources: Map<string, SceneNode>;
  assets: Map<string, StagedAssetEntry>;
  resolvedFonts: Map<string, DesignFontName>;
  warnings: DesignPlanWarning[];
}

/** 只读解析计划引用，所有文档写入必须留到 atomicMutation 的 mutate 阶段。 */
export async function validateDesignPlan(plan: DesignPlan): Promise<ValidatedDesignSource> {
  const roots = plan.source
    ? await Promise.all(plan.source.rootNodeIds.map(resolveCurrentPageNode))
    : [];
  assertUnique(
    roots.map((node) => node.id),
    'source root',
  );
  assertDisjointRoots(roots);

  const refs = new Set<string>();
  const cloneSources = new Map<string, SceneNode>();
  const assets = new Map<string, StagedAssetEntry>();
  const resolvedFonts = new Map<string, DesignFontName>();
  const warnings: DesignPlanWarning[] = [];
  const availableFonts = await figma.listAvailableFontsAsync();
  let nodeCount = 0;

  const visit = async (node: DesignNode, depth: number): Promise<void> => {
    nodeCount += 1;
    if (nodeCount > DESIGN_PLAN_MAX_NODES) {
      throw invalid(`DesignPlan exceeds the ${DESIGN_PLAN_MAX_NODES} node limit.`);
    }
    if (depth > DESIGN_PLAN_MAX_DEPTH) {
      throw invalid(`DesignPlan exceeds the ${DESIGN_PLAN_MAX_DEPTH} depth limit.`, node.ref);
    }
    if (refs.has(node.ref)) throw invalid(`Duplicate design ref: ${node.ref}.`, node.ref);
    refs.add(node.ref);

    if (node.kind === 'CLONE') {
      if (!plan.source) throw invalid('CLONE nodes require a source declaration.', node.ref);
      const source = await resolveCurrentPageNode(node.sourceNodeId);
      if (!roots.some((root) => isInside(root, source))) {
        throw invalid(`Clone source ${source.id} is outside declared source roots.`, node.ref);
      }
      if (hasInstanceAncestorWithinRoots(source, roots)) {
        throw invalid(`Clone source ${source.id} is inside an Instance.`, node.ref);
      }
      cloneSources.set(node.ref, source);
      return;
    }

    if (node.kind === 'TEXT') {
      validateTextRanges(node);
      resolveFont(`${node.ref}:base`, node.ref, node.text.font);
      for (const [index, range] of node.text.ranges.entries()) {
        if (range.font) resolveFont(`${node.ref}:range:${index}`, node.ref, range.font);
      }
    }

    if (node.kind === 'IMAGE' || node.kind === 'SVG') {
      const asset = assetCache.get(node.asset.assetId, node.asset.sha256);
      if (node.kind === 'IMAGE' && asset.kind !== 'RASTER') {
        throw invalid(`IMAGE ${node.ref} requires a raster asset.`, node.ref);
      }
      if (node.kind === 'SVG' && asset.kind !== 'SVG') {
        throw invalid(`SVG ${node.ref} requires an SVG asset.`, node.ref);
      }
      assets.set(node.ref, asset);
    }

    if (node.kind === 'FRAME') {
      for (const child of node.children) await visit(child, depth + 1);
    }
  };

  await visit(plan.root, 1);
  return { roots, cloneSources, assets, resolvedFonts, warnings };

  function resolveFont(
    key: string,
    ref: string,
    selection: {
      requested: DesignFontName;
      fallbacks: DesignFontName[];
      policy: 'STRICT' | 'ALLOW_FALLBACK';
    },
  ): void {
    const candidates =
      selection.policy === 'ALLOW_FALLBACK'
        ? [selection.requested, ...selection.fallbacks]
        : [selection.requested];
    const selected = candidates.find((candidate) =>
      availableFonts.some(
        (font) =>
          font.fontName.family === candidate.family && font.fontName.style === candidate.style,
      ),
    );
    if (!selected) {
      throw new BridgeFault({
        code: 'MISSING_FONT',
        message: `No permitted font is available for ${ref}: ${candidates
          .map((font) => `${font.family} ${font.style}`)
          .join(', ')}.`,
        retryable: true,
        details: { ref },
      });
    }
    resolvedFonts.set(key, selected);
    if (
      selected.family !== selection.requested.family ||
      selected.style !== selection.requested.style
    ) {
      warnings.push({
        code: 'FONT_FALLBACK',
        message: `${selection.requested.family} ${selection.requested.style} was replaced by ${selected.family} ${selected.style}.`,
        ref,
      });
    }
  }
}

/** apply 的只读预检阶段加载全部字体，确保进入 Undo 边界后不会因字体失败。 */
export async function preloadDesignFonts(source: ValidatedDesignSource): Promise<void> {
  const unique = new Map(
    [...source.resolvedFonts.values()].map((font) => [
      `${font.family}\u0000${font.style}\u0000${JSON.stringify(font.variationSettings ?? {})}`,
      font,
    ]),
  );
  try {
    await Promise.all(
      [...unique.values()].map((font) =>
        figma.loadFontAsync(
          font.variationSettings
            ? { family: font.family, style: font.style, variationSettings: font.variationSettings }
            : { family: font.family, style: font.style },
        ),
      ),
    );
  } catch (error) {
    throw new BridgeFault({
      code: 'MISSING_FONT',
      message: error instanceof Error ? error.message : 'A DesignPlan font could not be loaded.',
      retryable: true,
    });
  }
}

function validateTextRanges(node: Extract<DesignNode, { kind: 'TEXT' }>): void {
  for (const range of node.text.ranges) {
    if (range.end <= range.start || range.end > node.text.characters.length) {
      throw invalid(`Text range ${range.start}:${range.end} is outside ${node.ref}.`, node.ref);
    }
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw invalid(`Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function assertDisjointRoots(roots: SceneNode[]): void {
  for (const root of roots) {
    for (const other of roots) {
      if (root !== other && isInside(other, root)) {
        throw invalid(`Source roots cannot contain both ${other.id} and ${root.id}.`);
      }
    }
  }
}

function hasInstanceAncestorWithinRoots(node: SceneNode, roots: SceneNode[]): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'INSTANCE') return true;
    if (roots.some((root) => root.id === current?.id)) return false;
    current = current.parent;
  }
  return false;
}

function invalid(message: string, ref?: string): BridgeFault {
  return new BridgeFault({
    code: 'PLAN_INVALID',
    message,
    retryable: false,
    ...(ref ? { details: { ref } } : {}),
  });
}
