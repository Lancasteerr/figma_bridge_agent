import {
  BridgeFault,
  type DesignGeometry,
  type DesignNode,
  type DesignPaint,
  type DesignPlacement,
  type DesignPlan,
  type DesignText,
  type DesignVisual,
  type DesignResourceRef,
  type LayoutSpec,
  type SizingSpec,
} from '@figma-agent/protocol';

import { markProposal, markProposalBuilding } from '../proposal/marker.js';
import type { AppliedDesignResources } from './resources.js';
import type { ValidatedDesignSource } from './validator.js';

export interface ExecutedDesignPlan {
  root: FrameNode;
  refMap: Record<string, string>;
}

/** 在隐藏 Frame 内构建完整树，调用方负责用 atomicMutation 提供失败回滚。 */
export async function executeDesignPlan(
  plan: DesignPlan,
  source: ValidatedDesignSource,
  resources: AppliedDesignResources,
  operationId: string,
  planDigest: string,
): Promise<ExecutedDesignPlan> {
  const refMap: Record<string, string> = {};
  const root = figma.createFrame();
  root.visible = false;
  root.name = plan.proposal.name;
  figma.currentPage.appendChild(root);
  markProposalBuilding(root, plan.source?.rootNodeIds ?? [], operationId, planDigest);
  applyGeometry(root, plan.root.geometry);
  root.fills = [];

  try {
    for (const child of plan.root.children) {
      await appendNode(root, child, source, resources, refMap);
    }
    applyVisual(root, plan.root.visual);
    if (plan.root.clipsContent !== undefined) root.clipsContent = plan.root.clipsContent;
    applyContainerLayout(root, plan.root.layout, plan.root.placement?.sizing);
    applyPlacement(root, plan.root.placement);
    await applyBindings(root, plan.root, source, resources);
    positionRoot(root, plan, source.roots);
    refMap[plan.root.ref] = root.id;
    markProposal(
      root,
      plan.source?.rootNodeIds ?? [],
      plan.source?.rootNodeIds ?? [],
      operationId,
      planDigest,
    );
    root.visible = true;
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    return { root, refMap };
  } catch (error) {
    if (!root.removed) root.remove();
    throw error;
  }
}

async function appendNode(
  parent: ChildrenMixin & SceneNode,
  spec: DesignNode,
  source: ValidatedDesignSource,
  resources: AppliedDesignResources,
  refMap: Record<string, string>,
): Promise<void> {
  let node: SceneNode;
  if (spec.kind === 'CLONE') {
    const original = source.cloneSources.get(spec.ref);
    if (!original) throw invalid(`Clone source for ${spec.ref} is unavailable.`);
    node = original.clone();
    if (spec.name) node.name = spec.name;
    parent.appendChild(node);
    if (spec.geometry) applyGeometry(node, spec.geometry);
    applyPlacement(node, spec.placement);
  } else if (spec.kind === 'FRAME') {
    node = figma.createFrame();
    node.name = spec.name;
    parent.appendChild(node);
    applyGeometry(node, spec.geometry);
    node.fills = [];
    for (const child of spec.children) await appendNode(node, child, source, resources, refMap);
    applyVisual(node, spec.visual);
    if (spec.clipsContent !== undefined) node.clipsContent = spec.clipsContent;
    applyContainerLayout(node, spec.layout, spec.placement?.sizing);
    applyPlacement(node, spec.placement);
  } else if (spec.kind === 'TEXT') {
    const text = figma.createText();
    node = text;
    node.name = spec.name;
    parent.appendChild(node);
    applyText(text, spec.ref, spec.text, source);
    applyGeometry(text, spec.geometry);
    text.textAutoResize = spec.text.textAutoResize;
    applyVisual(text, spec.visual);
    applyPlacement(text, spec.placement);
  } else if (spec.kind === 'IMAGE') {
    const rectangle = figma.createRectangle();
    node = rectangle;
    node.name = spec.name;
    parent.appendChild(node);
    applyGeometry(node, spec.geometry);
    applyVisual(node, spec.visual);
    const asset = requiredAsset(source, spec.ref);
    if (!asset.rasterBytes) throw invalid(`Raster bytes for ${spec.ref} are unavailable.`);
    const image = figma.createImage(asset.rasterBytes);
    rectangle.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: spec.scaleMode }];
    applyPlacement(node, spec.placement);
  } else if (spec.kind === 'INSTANCE') {
    const original = source.instanceSources.get(spec.ref);
    if (!original) throw invalid(`Instance source for ${spec.ref} is unavailable.`);
    const instance =
      spec.source.mode === 'CREATE_INSTANCE'
        ? (original as ComponentNode).createInstance()
        : (original as InstanceNode).clone();
    node = instance;
    node.name = spec.name;
    parent.appendChild(node);
    instance.setProperties(spec.properties);
    applyGeometry(node, spec.geometry);
    applyVisual(node, spec.visual);
    applyPlacement(node, spec.placement);
  } else if (spec.kind === 'SVG') {
    const asset = requiredAsset(source, spec.ref);
    if (!asset.svgText) throw invalid(`SVG text for ${spec.ref} is unavailable.`);
    const svg = figma.createNodeFromSvg(asset.svgText);
    node = svg;
    node.name = spec.name;
    parent.appendChild(node);
    applyGeometry(node, spec.geometry);
    applyVisual(node, spec.visual);
    applyPlacement(node, spec.placement);
  } else {
    node = createPrimitiveNode(spec.kind);
    node.name = spec.name;
    parent.appendChild(node);
    applyGeometry(node, spec.geometry);
    applyVisual(node, spec.visual);
    applyPlacement(node, spec.placement);
  }
  if (spec.kind !== 'CLONE') await applyBindings(node, spec, source, resources);
  refMap[spec.ref] = node.id;
}

async function applyBindings(
  node: SceneNode,
  spec: Exclude<DesignNode, { kind: 'CLONE' }>,
  source: ValidatedDesignSource,
  resources: AppliedDesignResources,
): Promise<void> {
  const bindings = spec.styleBindings;
  if (bindings?.fill && 'setFillStyleIdAsync' in node) {
    await node.setFillStyleIdAsync(resolveStyle(bindings.fill, source, resources).id);
  }
  if (bindings?.stroke && 'setStrokeStyleIdAsync' in node) {
    await node.setStrokeStyleIdAsync(resolveStyle(bindings.stroke, source, resources).id);
  }
  if (bindings?.effect && 'setEffectStyleIdAsync' in node) {
    await node.setEffectStyleIdAsync(resolveStyle(bindings.effect, source, resources).id);
  }
  if (bindings?.grid && 'setGridStyleIdAsync' in node) {
    await node.setGridStyleIdAsync(resolveStyle(bindings.grid, source, resources).id);
  }
  if (bindings?.text && node.type === 'TEXT') {
    await node.setTextStyleIdAsync(resolveStyle(bindings.text, source, resources).id);
  }

  for (const binding of spec.variableBindings ?? []) {
    const variable = resolveVariable(binding.variable, source, resources);
    if (binding.target === 'PROPERTY') {
      node.setBoundVariable(binding.field, variable);
      continue;
    }
    const property = binding.target === 'FILL_COLOR' ? 'fills' : 'strokes';
    if (!(property in node)) throw invalid(`${binding.target} is unsupported on ${spec.ref}.`);
    const paintNode = node as SceneNode & { fills: readonly Paint[]; strokes: readonly Paint[] };
    const paints = [...paintNode[property]];
    const paint = paints[binding.paintIndex];
    if (!paint || paint.type !== 'SOLID') {
      throw invalid(`${binding.target} ${binding.paintIndex} must reference a solid paint.`);
    }
    paints[binding.paintIndex] = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
    paintNode[property] = paints;
  }
}

function resolveStyle(
  reference: DesignResourceRef,
  source: ValidatedDesignSource,
  resources: AppliedDesignResources,
): BaseStyle {
  const result =
    'ref' in reference
      ? resources.styles.get(reference.ref)
      : source.existingStyles.get(reference.id);
  if (!result) throw invalid(`Style reference is unavailable.`);
  return result;
}

function resolveVariable(
  reference: DesignResourceRef,
  source: ValidatedDesignSource,
  resources: AppliedDesignResources,
): Variable {
  const result =
    'ref' in reference
      ? resources.variables.get(reference.ref)
      : source.existingVariables.get(reference.id);
  if (!result) throw invalid(`Variable reference is unavailable.`);
  return result;
}

function createPrimitiveNode(kind: 'RECTANGLE' | 'ELLIPSE' | 'LINE'): SceneNode {
  if (kind === 'RECTANGLE') return figma.createRectangle();
  if (kind === 'ELLIPSE') return figma.createEllipse();
  if (kind === 'LINE') return figma.createLine();
  throw invalid(`Unsupported basic node kind: ${String(kind)}.`);
}

function applyGeometry(node: SceneNode, geometry: DesignGeometry): void {
  if ('resizeWithoutConstraints' in node)
    node.resizeWithoutConstraints(geometry.width, geometry.height);
  else if ('resize' in node) node.resize(geometry.width, geometry.height);
  node.x = geometry.x;
  node.y = geometry.y;
  if ('rotation' in node) node.rotation = geometry.rotation;
  if ('minWidth' in node) {
    if (geometry.minWidth !== undefined) node.minWidth = geometry.minWidth;
    if (geometry.maxWidth !== undefined) node.maxWidth = geometry.maxWidth;
    if (geometry.minHeight !== undefined) node.minHeight = geometry.minHeight;
    if (geometry.maxHeight !== undefined) node.maxHeight = geometry.maxHeight;
  }
  if (geometry.constraints && 'constraints' in node) node.constraints = geometry.constraints;
}

function applyContainerLayout(node: FrameNode, layout?: LayoutSpec, sizing?: SizingSpec): void {
  if (layout) {
    node.layoutMode = layout.mode;
    node.layoutWrap = layout.wrap;
    node.itemSpacing = layout.gap;
    node.paddingTop = layout.padding.top;
    node.paddingRight = layout.padding.right;
    node.paddingBottom = layout.padding.bottom;
    node.paddingLeft = layout.padding.left;
    node.primaryAxisAlignItems = layout.primaryAxisAlign;
    node.counterAxisAlignItems = layout.counterAxisAlign;
  }
  applySizing(node, sizing);
}

function applyPlacement(node: SceneNode, placement?: DesignPlacement): void {
  if (!placement) return;
  if (placement.positioning && 'layoutPositioning' in node) {
    node.layoutPositioning = placement.positioning;
  }
  if (placement.layoutGrow !== undefined && 'layoutGrow' in node) {
    node.layoutGrow = placement.layoutGrow;
  }
  if (placement.layoutAlign !== undefined && 'layoutAlign' in node) {
    node.layoutAlign = placement.layoutAlign;
  }
  applySizing(node, placement.sizing);
}

function applyVisual(node: SceneNode, visual?: DesignVisual): void {
  if (!visual) return;
  if (visual.fills && 'fills' in node) node.fills = visual.fills.map(toPaint);
  if (visual.strokes && 'strokes' in node) node.strokes = visual.strokes.map(toPaint);
  if (visual.strokeWeight !== undefined && 'strokeWeight' in node) {
    node.strokeWeight = visual.strokeWeight;
  }
  if (visual.strokeAlign !== undefined && 'strokeAlign' in node) {
    node.strokeAlign = visual.strokeAlign;
  }
  if (visual.dashPattern !== undefined && 'dashPattern' in node) {
    node.dashPattern = visual.dashPattern;
  }
  if (visual.cornerRadius !== undefined && 'cornerRadius' in node) {
    if ('topLeftRadius' in node) {
      const radii =
        typeof visual.cornerRadius === 'number'
          ? {
              topLeft: visual.cornerRadius,
              topRight: visual.cornerRadius,
              bottomRight: visual.cornerRadius,
              bottomLeft: visual.cornerRadius,
            }
          : visual.cornerRadius;
      node.topLeftRadius = radii.topLeft;
      node.topRightRadius = radii.topRight;
      node.bottomRightRadius = radii.bottomRight;
      node.bottomLeftRadius = radii.bottomLeft;
    }
  }
  if (visual.opacity !== undefined && 'opacity' in node) node.opacity = visual.opacity;
  if (visual.blendMode !== undefined && 'blendMode' in node) node.blendMode = visual.blendMode;
  if (visual.effects !== undefined && 'effects' in node) {
    node.effects = visual.effects as readonly Effect[];
  }
}

function applyText(
  node: TextNode,
  ref: string,
  text: DesignText,
  source: ValidatedDesignSource,
): void {
  node.textAutoResize = 'NONE';
  node.fontName = requiredFont(source, `${ref}:base`);
  node.characters = text.characters;
  node.fontSize = text.fontSize;
  node.lineHeight = text.lineHeight;
  node.letterSpacing = text.letterSpacing;
  node.textAlignHorizontal = text.textAlignHorizontal;
  node.textAlignVertical = text.textAlignVertical;
  node.textCase = text.textCase;
  node.textDecoration = text.textDecoration;
  node.paragraphSpacing = text.paragraphSpacing;

  for (const [index, range] of text.ranges.entries()) {
    const { start, end } = range;
    if (range.font)
      node.setRangeFontName(start, end, requiredFont(source, `${ref}:range:${index}`));
    if (range.fontSize !== undefined) node.setRangeFontSize(start, end, range.fontSize);
    if (range.lineHeight !== undefined) node.setRangeLineHeight(start, end, range.lineHeight);
    if (range.letterSpacing !== undefined) {
      node.setRangeLetterSpacing(start, end, range.letterSpacing);
    }
    if (range.fills !== undefined) node.setRangeFills(start, end, range.fills.map(toPaint));
    if (range.textCase !== undefined) node.setRangeTextCase(start, end, range.textCase);
    if (range.textDecoration !== undefined) {
      node.setRangeTextDecoration(start, end, range.textDecoration);
    }
  }
}

function requiredFont(source: ValidatedDesignSource, key: string): FontName {
  const font = source.resolvedFonts.get(key);
  if (!font) throw invalid(`Resolved font ${key} is unavailable.`);
  return font.variationSettings
    ? { family: font.family, style: font.style, variationSettings: font.variationSettings }
    : { family: font.family, style: font.style };
}

function requiredAsset(source: ValidatedDesignSource, ref: string) {
  const asset = source.assets.get(ref);
  if (!asset) throw invalid(`Resolved asset for ${ref} is unavailable.`);
  return asset;
}

function toPaint(paint: DesignPaint): Paint {
  return paint as Paint;
}

function applySizing(node: SceneNode, sizing?: SizingSpec): void {
  if (!sizing || !('layoutSizingHorizontal' in node)) return;
  if (sizing.horizontal) node.layoutSizingHorizontal = sizing.horizontal;
  if (sizing.vertical) node.layoutSizingVertical = sizing.vertical;
}

function positionRoot(root: FrameNode, plan: DesignPlan, sources: SceneNode[]): void {
  if (sources.length === 0) {
    root.x = plan.proposal.offsetX;
    root.y = plan.proposal.offsetY;
    return;
  }
  const boxes = sources.map((node) => node.absoluteBoundingBox ?? node);
  root.x = Math.max(...boxes.map((box) => box.x + box.width)) + plan.proposal.offsetX;
  root.y = Math.min(...boxes.map((box) => box.y)) + plan.proposal.offsetY;
}

function invalid(message: string): BridgeFault {
  return new BridgeFault({ code: 'PLAN_INVALID', message, retryable: false });
}
