import {
  LightweightTreeNodeRecordSchema,
  TreeArtifactManifestSchema,
  TreeResultSchema,
  type LightweightTreeNode,
  type LightweightTreeNodeRecord,
  type PublicTreeNode,
  type TreeRpcResult,
  type TreeResult,
} from '@figma-agent/protocol';

import type { StoredArtifact, TemporaryArtifactStore } from '../temp/artifact-store.js';

/** 包含 MCP 外层结构后的树结果最大公开字节数。 */
export const TREE_PUBLIC_RESULT_BUDGET_BYTES = 48 * 1024;

/** 小树直接内联；大树或显式文件模式写入 JSONL 并生成有界 overview。 */
export async function deliverTreeResult(
  tree: TreeRpcResult,
  requestedMode: 'AUTO' | 'TEMP_FILE',
  artifacts: TemporaryArtifactStore,
): Promise<TreeResult> {
  const records = flattenTree(tree.root);
  if (records.length !== tree.coverage.nodeCount) {
    throw new Error('Lightweight tree node count does not match coverage metadata.');
  }

  const publicRoot = toPublicNode(tree.root);
  const inline = TreeResultSchema.parse({
    root: publicRoot,
    ...(tree.coverage.truncation ? { truncation: tree.coverage.truncation } : {}),
  });
  if (requestedMode === 'AUTO' && publicResultBytes(inline) <= TREE_PUBLIC_RESULT_BUDGET_BYTES) {
    return inline;
  }

  const artifact = await writeTreeArtifact(tree, records, artifacts);
  return createOverview(tree, publicRoot, artifact);
}

function flattenTree(root: LightweightTreeNode): LightweightTreeNodeRecord[] {
  const records: LightweightTreeNodeRecord[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const { children, ...record } = node;
    records.push(LightweightTreeNodeRecordSchema.parse(record));
    queue.push(...children);
  }
  return records;
}

async function writeTreeArtifact(
  tree: TreeRpcResult,
  records: LightweightTreeNodeRecord[],
  artifacts: TemporaryArtifactStore,
): Promise<StoredArtifact> {
  const manifest = TreeArtifactManifestSchema.parse({
    recordType: 'manifest',
    schemaVersion: tree.schemaVersion,
    scope: tree.scope,
    coverage: tree.coverage,
  });
  const jsonl = [manifest, ...records].map((record) => JSON.stringify(record)).join('\n') + '\n';
  return await artifacts.write(`${tree.scope.rootNodeId}-tree.jsonl`, jsonl);
}

/** 按广度优先顺序纳入节点，先覆盖主要分支，再逐层补充细节。 */
function createOverview(
  tree: TreeRpcResult,
  publicRoot: PublicTreeNode,
  artifact: StoredArtifact,
): TreeResult {
  const root = cloneWithoutChildren(publicRoot);
  let frontier: Array<{ source: PublicTreeNode; target: PublicTreeNode }> = [
    { source: publicRoot, target: root },
  ];

  while (frontier.length > 0) {
    const next: Array<{ source: PublicTreeNode; target: PublicTreeNode }> = [];
    const widestBranch = Math.max(...frontier.map(({ source }) => source.children.length));
    // 同一深度按子节点序号轮询各父分支，避免首个大分支独占剩余预算。
    for (let childIndex = 0; childIndex < widestBranch; childIndex += 1) {
      for (const { source, target } of frontier) {
        const child = source.children[childIndex];
        if (!child) continue;
        const cloned = cloneWithoutChildren(child);
        target.children.push(cloned);
        const candidate = resultWithArtifact(tree, root, artifact);
        if (publicResultBytes(candidate) <= TREE_PUBLIC_RESULT_BUDGET_BYTES) {
          next.push({ source: child, target: cloned });
        } else {
          target.children.pop();
        }
      }
    }
    frontier = next;
  }

  const result = resultWithArtifact(tree, root, artifact);
  if (publicResultBytes(result) > TREE_PUBLIC_RESULT_BUDGET_BYTES) {
    throw new Error('Tree overview cannot fit within the public result budget.');
  }
  return TreeResultSchema.parse(result);
}

function cloneWithoutChildren(node: PublicTreeNode): PublicTreeNode {
  return { ...node, children: [] };
}

function resultWithArtifact(
  tree: TreeRpcResult,
  root: PublicTreeNode,
  artifact: StoredArtifact,
): TreeResult {
  return {
    root,
    ...(tree.coverage.truncation ? { truncation: tree.coverage.truncation } : {}),
    artifact: {
      localPath: artifact.localPath,
      expiresAt: artifact.expiresAt,
    },
  };
}

/** 将插件内部树投影为 Agent 导航所需字段，并省略默认值与空素材提示。 */
function toPublicNode(node: LightweightTreeNode): PublicTreeNode {
  const hasAssetHints =
    node.assetHints.imagePaintCount > 0 ||
    node.assetHints.exportSettingCount > 0 ||
    node.assetHints.hasVector ||
    node.assetHints.isMask;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    navigationBoundsInParent: node.geometry.local,
    childCount: node.childCount,
    ...(node.visible ? {} : { visible: false as const }),
    ...(node.layoutMode && node.layoutMode !== 'NONE' ? { layoutMode: node.layoutMode } : {}),
    ...(node.positioning && node.positioning !== 'AUTO' ? { positioning: node.positioning } : {}),
    ...(node.textPreview ? { textPreview: node.textPreview } : {}),
    ...(node.componentHint ? { componentKind: node.componentHint.kind } : {}),
    ...(hasAssetHints ? { assetHints: node.assetHints } : {}),
    children: node.children.map(toPublicNode),
  };
}

/** 将 SDK 要求的空 content 外层也计入硬预算。 */
function publicResultBytes(result: TreeResult): number {
  return Buffer.byteLength(JSON.stringify({ content: [], structuredContent: result }), 'utf8');
}
