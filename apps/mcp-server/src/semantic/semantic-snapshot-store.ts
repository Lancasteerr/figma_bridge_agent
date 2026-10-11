import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

import {
  BRIDGE_PROTOCOL_VERSION,
  SemanticSnapshotManifestSchema,
  type ExportSemanticScopeResult,
  type ExportSemanticScopeRpcResult,
} from '@figma-agent/protocol';

import { SafeSessionWriter } from '../storage/safe-session-writer.js';
import type { SessionWorkspace } from '../storage/session-workspace.js';

const CACHE_ROOT = '.figma_bridge_agent';

interface SemanticSnapshotStoreOptions {
  now?: () => Date;
  pluginVersion?: () => string | undefined;
}

/** 把插件返回的语义正文持久化为不可变会话快照，并仅返回可审查的路径和摘要。 */
export class SemanticSnapshotStore {
  readonly #writer: SafeSessionWriter;
  readonly #createdAt: string;
  readonly #pluginVersion: () => string | undefined;
  #sessionWrite?: Promise<void>;

  constructor(
    readonly workspace: SessionWorkspace,
    options: SemanticSnapshotStoreOptions = {},
  ) {
    this.#writer = new SafeSessionWriter(workspace);
    this.#createdAt = (options.now?.() ?? new Date()).toISOString();
    this.#pluginVersion = options.pluginVersion ?? (() => undefined);
  }

  async write(result: ExportSemanticScopeRpcResult): Promise<ExportSemanticScopeResult> {
    await this.#ensureSessionFiles(result);
    const scopeId = scopeKey(result.rootNodeId);
    const variant = snapshotVariant(result);
    const directory = `${sessionRoot(this.workspace.sessionId)}/scopes/${scopeId}/${result.sourceFingerprint}/${variant}`;

    const outline = await this.#writer.write({
      relativePath: `${directory}/outline.jsonl`,
      data: result.outlineJsonl,
      writePolicy: 'REUSE_OR_FAIL',
    });
    const facts = await this.#writer.write({
      relativePath: `${directory}/facts.jsonl`,
      data: result.factsJsonl,
      writePolicy: 'REUSE_OR_FAIL',
    });
    const render = result.render
      ? await this.#writer.write({
          relativePath: `${directory}/render.png`,
          data: decodePng(result.render.data),
          writePolicy: 'REUSE_OR_FAIL',
        })
      : undefined;

    const manifest = SemanticSnapshotManifestSchema.parse({
      schemaVersion: 1,
      sessionId: this.workspace.sessionId,
      scopeId,
      rootNodeId: result.rootNodeId,
      rootNodeName: result.rootNodeName,
      page: result.page,
      profile: result.profile,
      request: result.request,
      sourceFingerprint: result.sourceFingerprint,
      nodeCount: result.nodeCount,
      complete: result.complete,
      truncation: result.truncation,
      files: {
        outline: 'outline.jsonl',
        facts: 'facts.jsonl',
        ...(render ? { render: 'render.png' } : {}),
      },
      sha256: {
        outline: outline.sha256,
        facts: facts.sha256,
        ...(render ? { render: render.sha256 } : {}),
      },
      createdAt: this.#createdAt,
    });
    // manifest 最后写入，存在 manifest 即表示该快照修订已经完整提交。
    const manifestFile = await this.#writer.write({
      relativePath: `${directory}/manifest.json`,
      data: `${JSON.stringify(manifest, null, 2)}\n`,
      writePolicy: 'REUSE_OR_FAIL',
    });
    const status = this.workspace.status;
    return {
      sessionId: this.workspace.sessionId,
      scopeId,
      rootNodeId: result.rootNodeId,
      sourceFingerprint: result.sourceFingerprint,
      delivery: status.delivery,
      projectRelativePath: directory,
      absolutePath: dirname(manifestFile.absolutePath),
      manifestPath: manifestFile.absolutePath,
      requiresCopy: status.delivery === 'STAGED',
      nodeCount: result.nodeCount,
      complete: result.complete,
      sha256: manifestFile.sha256,
      bytes: outline.bytes + facts.bytes + (render?.bytes ?? 0) + manifestFile.bytes,
    };
  }

  async #ensureSessionFiles(result: ExportSemanticScopeRpcResult): Promise<void> {
    this.#sessionWrite ??= this.#writeSessionFiles(result);
    await this.#sessionWrite;
  }

  async #writeSessionFiles(result: ExportSemanticScopeRpcResult): Promise<void> {
    await this.#writer.write({
      relativePath: `${CACHE_ROOT}/.gitignore`,
      data: '*\n',
      writePolicy: 'REUSE_OR_FAIL',
    });
    const status = this.workspace.status;
    await this.#writer.write({
      relativePath: `${sessionRoot(this.workspace.sessionId)}/session.json`,
      data: `${JSON.stringify(
        {
          schemaVersion: 1,
          sessionId: this.workspace.sessionId,
          delivery: status.delivery,
          workspaceRoot: status.rootPath,
          document: result.document,
          page: result.page,
          ...(this.#pluginVersion() ? { pluginVersion: this.#pluginVersion() } : {}),
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          createdAt: this.#createdAt,
        },
        null,
        2,
      )}\n`,
      writePolicy: 'REUSE_OR_FAIL',
    });
  }
}

function sessionRoot(sessionId: string): string {
  return `${CACHE_ROOT}/sessions/${sessionId}`;
}

function scopeKey(nodeId: string): string {
  return `scope-${createHash('sha256').update(nodeId).digest('hex').slice(0, 12)}`;
}

function snapshotVariant(result: ExportSemanticScopeRpcResult): string {
  const source = JSON.stringify({
    profile: result.profile,
    focusNodeIds: [...result.request.focusNodeIds].sort(),
    includeRender: result.request.includeRender,
    depth: result.request.depth,
    maxNodes: result.request.maxNodes,
    maxTextLength: result.request.maxTextLength,
  });
  return `snapshot-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
}

function decodePng(data: string): Uint8Array {
  const bytes = Buffer.from(data, 'base64');
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Semantic scope render is not a valid PNG payload.');
  }
  return bytes;
}
