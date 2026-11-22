import {
  BridgeFault,
  DeleteNodesInputSchema,
  EditInPlaceInputSchema,
  type InPlaceOperation,
} from '@figma-agent/protocol';

import { assetCache } from '../assets/asset-cache.js';
import { atomicMutation } from '../mutation/coordinator.js';
import { isInside } from '../proposal/marker.js';
import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { validateLayoutInput } from './layout.js';
import { preflightFonts } from './text.js';

function fault(
  code:
    | 'NODE_LOCKED'
    | 'NODE_INSIDE_INSTANCE'
    | 'NODE_OUTSIDE_EDIT_SCOPE'
    | 'EDIT_SCOPE_CHANGED'
    | 'UNSUPPORTED_NODE_TYPE'
    | 'INVALID_ASSET',
  message: string,
  nodeId?: string,
): never {
  throw new BridgeFault({
    code,
    message,
    nodeId,
    retryable: code === 'EDIT_SCOPE_CHANGED' || code === 'NODE_LOCKED',
  });
}

/** Check ancestors too: a locked containing frame and Instance internals are not writable. */
function assertWritable(node: SceneNode): void {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if ('locked' in current && current.locked)
      fault('NODE_LOCKED', `Node ${current.id} is locked.`, current.id);
    if (current.type === 'INSTANCE')
      fault(
        'NODE_INSIDE_INSTANCE',
        'Use exposed instance properties instead of editing instance internals.',
        node.id,
      );
    current = current.parent;
  }
}

async function checkScope(scopeRootId: string, ids: string[], expected: string) {
  const pageId = figma.currentPage.id;
  const root = await resolveCurrentPageNode(scopeRootId);
  const targets = await Promise.all(ids.map(resolveCurrentPageNode));
  for (const target of [root, ...targets]) {
    if (!isInside(root, target))
      fault(
        'NODE_OUTSIDE_EDIT_SCOPE',
        `Node ${target.id} is outside edit scope ${root.id}.`,
        target.id,
      );
    assertWritable(target);
  }
  const actual = await fingerprintNodeTree([root]);
  if (figma.currentPage.id !== pageId || actual !== expected)
    fault(
      'EDIT_SCOPE_CHANGED',
      'The edit scope changed; inspect it again before retrying.',
      root.id,
    );
  // Fingerprinting may await image/component reads. Recheck membership and ancestor locks afterward.
  for (const target of [root, ...targets]) {
    if (target.removed || !isInside(root, target))
      fault(
        'EDIT_SCOPE_CHANGED',
        'An edit target moved or was removed during inspection.',
        target.id,
      );
    assertWritable(target);
  }
  return { root, targets, pageId };
}

function container(node: SceneNode): FrameNode | ComponentNode | GroupNode | SectionNode {
  if (
    node.type !== 'FRAME' &&
    node.type !== 'COMPONENT' &&
    node.type !== 'GROUP' &&
    node.type !== 'SECTION'
  )
    fault('UNSUPPORTED_NODE_TYPE', `Node ${node.id} cannot receive children.`, node.id);
  return node;
}

function operationTarget(op: InPlaceOperation): string {
  return 'parentId' in op ? op.parentId : op.nodeId;
}

/** No Proposal marker is created or forged. Every request explicitly authorizes an original scope. */
export async function editInPlace(params: unknown) {
  const input = EditInPlaceInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const ids = input.operations.map(operationTarget);
      const { root, targets, pageId } = await checkScope(
        input.scopeRootId,
        ids,
        input.expectedFingerprint,
      );
      const rasters = new Map<string, Uint8Array>();
      for (const [index, op] of input.operations.entries()) {
        const node = targets[index]!;
        if (op.type === 'TEXT') {
          if (node.type !== 'TEXT')
            fault('UNSUPPORTED_NODE_TYPE', 'TEXT requires a Text node.', node.id);
          await preflightFonts(node, op.fontName);
        } else if (op.type === 'LAYOUT') {
          // Ordinary canvas children use x/y directly; ABSOLUTE is only required inside Auto Layout.
          const { absolute, ...layoutInput } = op;
          const autoParent =
            node.parent && 'layoutMode' in node.parent && node.parent.layoutMode !== 'NONE';
          validateLayoutInput(node, {
            ...layoutInput,
            proposalRootId: root.id,
            ...(autoParent && absolute ? { absolute } : {}),
          });
        } else if (op.type === 'RESIZE') {
          if (!('resize' in node))
            fault('UNSUPPORTED_NODE_TYPE', 'This node cannot be resized.', node.id);
        } else {
          container(node);
          if (op.type === 'CAROUSEL') {
            for (const id of op.assetIds) {
              const asset = assetCache.get(id);
              if (asset.kind !== 'RASTER' || !asset.rasterBytes)
                fault('INVALID_ASSET', 'Carousel slides require staged raster images.');
              rasters.set(id, asset.rasterBytes);
            }
          }
        }
      }
      // Font loading can yield to user edits or page switches. Check again before opening Undo.
      if (figma.currentPage.id !== pageId)
        fault('EDIT_SCOPE_CHANGED', 'The current page changed during preparation.', root.id);
      await checkScope(input.scopeRootId, ids, input.expectedFingerprint);
      return { root, targets, rasters };
    },
    mutate: async ({ root, targets, rasters }) => {
      const createdNodeIds: string[] = [];
      for (const [index, op] of input.operations.entries()) {
        const node = targets[index]!;
        if (op.type === 'TEXT' && node.type === 'TEXT') {
          if (op.fontName) node.fontName = op.fontName;
          if (op.characters !== undefined) node.characters = op.characters;
          if (op.fontSize !== undefined) node.fontSize = op.fontSize;
          if (op.lineHeight !== undefined)
            node.lineHeight = { value: op.lineHeight, unit: 'PIXELS' };
        } else if (op.type === 'RESIZE' && 'resize' in node) {
          node.resize(op.width, op.height);
        } else if (op.type === 'LAYOUT') {
          if (
            op.layout &&
            (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
          ) {
            node.layoutMode = op.layout.mode;
            node.itemSpacing = op.layout.gap;
            node.paddingTop = op.layout.padding.top;
            node.paddingRight = op.layout.padding.right;
            node.paddingBottom = op.layout.padding.bottom;
            node.paddingLeft = op.layout.padding.left;
            node.primaryAxisAlignItems = op.layout.primaryAxisAlign;
            node.counterAxisAlignItems = op.layout.counterAxisAlign;
            node.layoutWrap = 'NO_WRAP';
          }
          if (op.sizing && 'layoutSizingHorizontal' in node) {
            if (op.sizing.horizontal) node.layoutSizingHorizontal = op.sizing.horizontal;
            if (op.sizing.vertical) node.layoutSizingVertical = op.sizing.vertical;
          }
          if (op.positioning && 'layoutPositioning' in node)
            node.layoutPositioning = op.positioning;
          if (op.absolute) {
            node.x = op.absolute.x;
            node.y = op.absolute.y;
          }
        } else if (op.type === 'CREATE_FRAME' || op.type === 'CAROUSEL') {
          const parent = container(node);
          const frame = figma.createFrame();
          frame.name = op.name;
          frame.resizeWithoutConstraints(op.width, op.height);
          parent.insertChild(
            op.type === 'CREATE_FRAME'
              ? Math.min(op.index ?? parent.children.length, parent.children.length)
              : parent.children.length,
            frame,
          );
          frame.x = op.x;
          frame.y = op.y;
          createdNodeIds.push(frame.id);
          if (op.type === 'CAROUSEL') {
            frame.clipsContent = true;
            frame.overflowDirection = 'HORIZONTAL';
            for (const [slideIndex, id] of op.assetIds.entries()) {
              const slide = figma.createRectangle();
              frame.appendChild(slide);
              slide.name = `Slide ${slideIndex + 1}`;
              slide.resize(op.width, op.height);
              slide.x = slideIndex * (op.width + op.gap);
              slide.y = 0;
              slide.fills = [
                {
                  type: 'IMAGE',
                  imageHash: figma.createImage(rasters.get(id)!).hash,
                  scaleMode: 'FILL',
                },
              ];
              createdNodeIds.push(slide.id);
            }
          }
        }
      }
      return {
        scopeRootId: root.id,
        treeFingerprint: await fingerprintNodeTree([root]),
        createdNodeIds,
      };
    },
  });
}

/** Deletion is separate from edits, rejects overlapping IDs, and can explicitly remove the scope root. */
export async function deleteNodes(params: unknown) {
  const input = DeleteNodesInputSchema.parse(params);
  return await atomicMutation({
    prepare: async () => {
      const prepared = await checkScope(
        input.scopeRootId,
        input.nodeIds,
        input.expectedFingerprint,
      );
      for (const node of prepared.targets) {
        if (prepared.targets.some((other) => other.id !== node.id && isInside(other, node))) {
          fault(
            'NODE_OUTSIDE_EDIT_SCOPE',
            'Do not specify both a node and its descendant for deletion.',
            node.id,
          );
        }
        // Removing a frame removes all children: locked descendants must also block the request.
        const visit = (child: SceneNode): void => {
          if (child.locked) fault('NODE_LOCKED', `Node ${child.id} is locked.`, child.id);
          if ('children' in child) child.children.forEach(visit);
        };
        visit(node);
      }
      return prepared;
    },
    mutate: async ({ root, targets }) => {
      const scopeRemoved = targets.some((node) => node.id === root.id);
      for (const node of targets) node.remove();
      return {
        deletedNodeIds: input.nodeIds,
        scopeRemoved,
        treeFingerprint: scopeRemoved ? null : await fingerprintNodeTree([root]),
      };
    },
  });
}
