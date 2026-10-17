import {
  type ExportSemanticScopeRpcResult,
  type SemanticFactRecord,
  type SemanticOutlineRecord,
  type SemanticTruncation,
} from '@figma-agent/protocol';

import { createSerializeContext, serializeNode } from './node-snapshot.js';
import { projectCompactNode } from './compact-node.js';
import { isSceneNode } from './resolve.js';

interface SerializeSemanticScopeInput {
  root: SceneNode;
  profile: 'OUTLINE' | 'IMPLEMENTATION';
  focusNodes: readonly SceneNode[];
  depth: number;
  maxNodes: number;
  maxTextLength: number;
}

type SemanticPayload = Pick<
  ExportSemanticScopeRpcResult,
  'nodeCount' | 'complete' | 'truncation' | 'outlineJsonl' | 'factsJsonl'
>;

/**
 * 将范围序列化为稳定的扁平 JSONL。outline 始终保留完整范围结构，
 * focusNodes 只限制详细 facts，避免为少数关键节点写入全树细节。
 */
export async function serializeSemanticScope(
  input: SerializeSemanticScopeInput,
): Promise<SemanticPayload> {
  const outline: SemanticOutlineRecord[] = [];
  const facts: SemanticFactRecord[] = [];
  const context = createSerializeContext();
  const focusIds = new Set(input.focusNodes.map((node) => node.id));
  const reasons = new Set<SemanticTruncation['reasons'][number]>();
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
    const snapshot = await serializeNode(node, { maxTextLength: input.maxTextLength }, context);
    const compact = projectCompactNode(snapshot, [
      'BOUNDS',
      'LAYOUT',
      'TEXT',
      'APPEARANCE',
      'ASSET_SOURCES',
      'COMPONENT',
    ]);
    const children = 'children' in node ? node.children.filter(isSceneNode) : [];
    outline.push({
      nodeId: node.id,
      parentId,
      depth,
      order,
      name: node.name,
      type: node.type,
      ...(compact.visible === false ? { visible: false as const } : {}),
      ...(compact.bounds ? { navigationBoundsInParent: compact.bounds.inParent } : {}),
      ...(compact.layout?.mode ? { layoutMode: compact.layout.mode } : {}),
      childCount: children.length,
    });

    const includeFact =
      input.profile === 'IMPLEMENTATION' && (focusIds.size === 0 || focusIds.has(node.id));
    if (includeFact) {
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
    for (const child of children) {
      if (outline.length >= input.maxNodes) {
        const start = children.indexOf(child);
        omit(children.slice(start), 'NODE_LIMIT');
        break;
      }
      await visit(child, depth + 1, children.indexOf(child), node.id);
    }
  };

  await visit(input.root, 0, 0, null);
  const structuralReasons = [...reasons].filter((reason) => reason !== 'TEXT_LIMIT');
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
    complete: structuralReasons.length === 0,
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
