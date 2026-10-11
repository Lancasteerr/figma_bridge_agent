import {
  type ExportSemanticScopeRpcResult,
  type SemanticFactRecord,
  type SemanticOutlineRecord,
  type SemanticTruncation,
} from '@figma-agent/protocol';

import { createSerializeContext, serializeNode } from './node-snapshot.js';
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
 * 将范围序列化为稳定的扁平 JSONL。指定 focusNodes 时只遍历根到焦点的路径，
 * 避免为了少数关键节点把整个组件细节重新注入磁盘快照。
 */
export async function serializeSemanticScope(
  input: SerializeSemanticScopeInput,
): Promise<SemanticPayload> {
  const outline: SemanticOutlineRecord[] = [];
  const facts: SemanticFactRecord[] = [];
  const context = createSerializeContext();
  const focusIds = new Set(input.focusNodes.map((node) => node.id));
  const focusedPathIds = collectFocusedPathIds(input.root, input.focusNodes);
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
    const children = 'children' in node ? node.children.filter(isSceneNode) : [];
    outline.push({
      nodeId: node.id,
      parentId,
      depth,
      order,
      name: node.name,
      type: node.type,
      ...('visible' in node ? { visible: node.visible } : {}),
      geometry: snapshot.geometry,
      ...(snapshot.layout?.mode ? { layoutMode: snapshot.layout.mode } : {}),
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
        ...('visible' in node ? { visible: node.visible } : {}),
        ...('locked' in node ? { locked: node.locked } : {}),
        geometry: snapshot.geometry,
        ...(snapshot.layout ? { layout: snapshot.layout } : {}),
        ...(snapshot.text ? { text: snapshot.text } : {}),
        ...(snapshot.visual ? { visual: snapshot.visual } : {}),
        ...(snapshot.assets ? { assets: snapshot.assets } : {}),
        ...(snapshot.component ? { component: snapshot.component } : {}),
      });
      if (snapshot.text?.truncated) reasons.add('TEXT_LIMIT');
    }

    const selectedChildren =
      focusedPathIds.size > 0 ? children.filter((child) => focusedPathIds.has(child.id)) : children;
    if (depth >= input.depth) {
      omit(selectedChildren, 'DEPTH_LIMIT');
      return;
    }
    for (const child of selectedChildren) {
      if (outline.length >= input.maxNodes) {
        const start = selectedChildren.indexOf(child);
        omit(selectedChildren.slice(start), 'NODE_LIMIT');
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

function collectFocusedPathIds(root: SceneNode, focusNodes: readonly SceneNode[]): Set<string> {
  const ids = new Set<string>();
  for (const focus of focusNodes) {
    let current: BaseNode | null = focus;
    while (current && current.id !== root.id) {
      if (isSceneNode(current)) ids.add(current.id);
      current = current.parent;
    }
    ids.add(root.id);
  }
  return ids;
}

function toJsonl(records: readonly unknown[]): string {
  return records.length > 0
    ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
    : '';
}
