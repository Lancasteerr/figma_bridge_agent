import {
  type ScopeIndexRecord,
  type ScopeTruncation,
  type WorkunitFactRecord,
} from '@figma-agent/protocol';

import { projectCompactNode } from './compact-node.js';
import { serializeLightweightTreeNode } from './lightweight-tree.js';
import { createSerializeContext, serializeNode } from './node-snapshot.js';
import { isSceneNode } from './resolve.js';

interface ScopeLimits {
  root: SceneNode;
  depth: number;
  maxNodes: number;
  maxTextLength: number;
}

interface ScopePayload {
  nodeCount: number;
  complete: boolean;
  truncation: ScopeTruncation | null;
  outlineJsonl: string;
}

/** 大型范围只建立结构索引，不读取完整视觉事实。 */
export async function serializeScopeIndex(input: ScopeLimits): Promise<ScopePayload> {
  const result = await serializeScope(input);
  return {
    nodeCount: result.nodeCount,
    complete: result.complete,
    truncation: result.truncation,
    outlineJsonl: result.outlineJsonl,
  };
}

/** workunit 始终生成实施事实；空 factNodes 表示读取有界范围内的全部节点。 */
export async function serializeWorkunitSource(
  input: ScopeLimits & { factNodes: readonly SceneNode[] },
): Promise<ScopePayload & { factsJsonl: string }> {
  return await serializeScope(input);
}

async function serializeScope(
  input: ScopeLimits & { factNodes?: readonly SceneNode[] },
): Promise<ScopePayload & { factsJsonl: string }> {
  const outline: ScopeIndexRecord[] = [];
  const facts: WorkunitFactRecord[] = [];
  const context = createSerializeContext();
  const includeFacts = input.factNodes !== undefined;
  const factIds = new Set(input.factNodes?.map((node) => node.id) ?? []);
  const reasons = new Set<ScopeTruncation['reasons'][number]>();
  const frontierNodeIds: string[] = [];
  let omittedChildCount = 0;

  const omit = (nodes: readonly SceneNode[], reason: 'DEPTH_LIMIT' | 'NODE_LIMIT'): void => {
    if (nodes.length === 0) return;
    reasons.add(reason);
    omittedChildCount += nodes.length;
    for (const node of nodes) frontierNodeIds.push(node.id);
  };

  const visit = async (
    node: SceneNode,
    depth: number,
    order: number,
    parentId: string | null,
  ): Promise<void> => {
    const children = 'children' in node ? node.children.filter(isSceneNode) : [];
    const navigation = serializeLightweightTreeNode(node, order, input.maxTextLength);
    outline.push({
      nodeId: node.id,
      parentId,
      depth,
      order,
      name: node.name,
      type: node.type,
      ...(navigation.visible ? {} : { visible: false as const }),
      navigationBoundsInParent: navigation.geometry.local,
      ...(navigation.layoutMode ? { layoutMode: navigation.layoutMode } : {}),
      childCount: children.length,
    });

    if (includeFacts && (factIds.size === 0 || factIds.has(node.id))) {
      const snapshot = await serializeNode(node, { maxTextLength: input.maxTextLength }, context);
      const compact = projectCompactNode(snapshot, [
        'BOUNDS',
        'LAYOUT',
        'TEXT',
        'APPEARANCE',
        'ASSET_SOURCES',
        'COMPONENT',
      ]);
      facts.push({
        nodeId: node.id,
        parentId,
        depth,
        order,
        name: node.name,
        type: node.type,
        ...(compact.visible === false ? { visible: false as const } : {}),
        ...(compact.locked === true ? { locked: true as const } : {}),
        ...(compact.bounds ? { bounds: compact.bounds } : {}),
        ...(compact.layout ? { layout: compact.layout } : {}),
        ...(compact.text ? { text: compact.text } : {}),
        ...(compact.appearance ? { appearance: compact.appearance } : {}),
        ...(compact.assetSources ? { assetSources: compact.assetSources } : {}),
        ...(compact.component ? { component: compact.component } : {}),
      });
      if (snapshot.text?.truncated) reasons.add('TEXT_LIMIT');
    }

    if (depth >= input.depth) {
      omit(children, 'DEPTH_LIMIT');
      return;
    }
    for (const [childOrder, child] of children.entries()) {
      if (outline.length >= input.maxNodes) {
        omit(children.slice(childOrder), 'NODE_LIMIT');
        break;
      }
      await visit(child, depth + 1, childOrder, node.id);
    }
  };

  await visit(input.root, 0, 0, null);
  const truncation =
    reasons.size > 0
      ? {
          reasons: [...reasons],
          frontierNodeIds: [...new Set(frontierNodeIds)],
          omittedChildCount,
        }
      : null;
  return {
    nodeCount: outline.length,
    complete: reasons.size === 0,
    truncation,
    outlineJsonl: toJsonl(outline),
    factsJsonl: toJsonl(facts),
  };
}

function toJsonl(records: readonly unknown[]): string {
  return records.length > 0
    ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : '';
}
