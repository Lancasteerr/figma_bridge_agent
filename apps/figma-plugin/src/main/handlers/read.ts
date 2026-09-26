import {
  GetNodeInputSchema,
  GetTreeInputSchema,
  type SelectionResultSchema,
  type SnapshotTreeNode,
  type TreeResult,
} from '@figma-agent/protocol';
import type { z } from 'zod';

import { serializeNodeSummary } from '../serialization/node-summary.js';
import { serializeNode } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { isSceneNode } from '../serialization/resolve.js';

type SelectionResult = z.infer<typeof SelectionResultSchema>;

export function getSelection(): SelectionResult {
  return {
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: figma.currentPage.selection.map(serializeNodeSummary),
  };
}

export async function getNode(params: unknown) {
  const { nodeId } = GetNodeInputSchema.parse(params);
  return await serializeNode(await resolveCurrentPageNode(nodeId));
}

export async function getTree(params: unknown): Promise<TreeResult> {
  const input = GetTreeInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.nodeId);
  let nodeCount = 0;
  let limitReached = false;

  const visit = async (node: SceneNode, depth: number): Promise<SnapshotTreeNode> => {
    nodeCount += 1;
    const snapshot = await serializeNode(node, { maxTextLength: input.maxTextLength });
    const childNodes = 'children' in node ? node.children.filter(isSceneNode) : [];
    const expanded: SnapshotTreeNode[] = [];
    if (depth > 0) {
      for (const child of childNodes) {
        if (nodeCount >= input.maxNodes) {
          limitReached = true;
          break;
        }
        expanded.push(await visit(child, depth - 1));
      }
    }
    const depthTruncated = depth === 0 && childNodes.length > 0;
    return {
      ...snapshot,
      children: expanded,
      truncated: snapshot.truncated || depthTruncated || limitReached,
    };
  };

  const tree = await visit(root, input.depth);
  return { root: tree, nodeCount, truncated: tree.truncated };
}
