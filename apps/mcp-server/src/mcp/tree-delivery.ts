import {
  LightweightTreeNodeRecordSchema,
  TreeArtifactManifestSchema,
  TreeResultSchema,
  type LightweightTreeNode,
  type LightweightTreeNodeRecord,
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

  const inline = TreeResultSchema.parse({
    ...tree,
    delivery: {
      mode: 'INLINE',
      inlineComplete: true,
      inlineNodeCount: records.length,
    },
  });
  if (requestedMode === 'AUTO' && publicResultBytes(inline) <= TREE_PUBLIC_RESULT_BUDGET_BYTES) {
    return inline;
  }

  const artifact = await writeTreeArtifact(tree, records, artifacts);
  return createOverview(tree, records.length, artifact);
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
  artifactNodeCount: number,
  artifact: StoredArtifact,
): TreeResult {
  const root = cloneWithoutChildren(tree.root);
  let frontier: Array<{ source: LightweightTreeNode; target: LightweightTreeNode }> = [
    { source: tree.root, target: root },
  ];
  let inlineNodeCount = 1;

  while (frontier.length > 0) {
    const next: Array<{ source: LightweightTreeNode; target: LightweightTreeNode }> = [];
    const widestBranch = Math.max(...frontier.map(({ source }) => source.children.length));
    // 同一深度按子节点序号轮询各父分支，避免首个大分支独占剩余预算。
    for (let childIndex = 0; childIndex < widestBranch; childIndex += 1) {
      for (const { source, target } of frontier) {
        const child = source.children[childIndex];
        if (!child) continue;
        const cloned = cloneWithoutChildren(child);
        target.children.push(cloned);
        const candidateCount = inlineNodeCount + 1;
        const candidate = resultWithArtifact(
          tree,
          root,
          candidateCount,
          artifactNodeCount,
          artifact,
        );
        if (publicResultBytes(candidate) <= TREE_PUBLIC_RESULT_BUDGET_BYTES) {
          inlineNodeCount = candidateCount;
          next.push({ source: child, target: cloned });
        } else {
          target.children.pop();
        }
      }
    }
    frontier = next;
  }

  const result = resultWithArtifact(tree, root, inlineNodeCount, artifactNodeCount, artifact);
  if (publicResultBytes(result) > TREE_PUBLIC_RESULT_BUDGET_BYTES) {
    throw new Error('Tree overview cannot fit within the public result budget.');
  }
  return TreeResultSchema.parse(result);
}

function cloneWithoutChildren(node: LightweightTreeNode): LightweightTreeNode {
  const record = Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'children'));
  return { ...LightweightTreeNodeRecordSchema.parse(record), children: [] };
}

function resultWithArtifact(
  tree: TreeRpcResult,
  root: LightweightTreeNode,
  inlineNodeCount: number,
  artifactNodeCount: number,
  artifact: StoredArtifact,
): TreeResult {
  return {
    schemaVersion: tree.schemaVersion,
    scope: tree.scope,
    coverage: tree.coverage,
    delivery: {
      mode: 'TEMP_FILE',
      inlineComplete: false,
      inlineNodeCount,
      artifactNodeCount,
      ...artifact,
    },
    root,
  };
}

/** 将 SDK 要求的空 content 外层也计入硬预算。 */
function publicResultBytes(result: TreeResult): number {
  return Buffer.byteLength(JSON.stringify({ content: [], structuredContent: result }), 'utf8');
}
