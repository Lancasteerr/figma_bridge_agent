import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeFault,
  type FidelityPolicySchema,
  type IndexScopeResult,
  type IndexScopeRpcResult,
  type PrepareWorkunitResult,
  type PrepareWorkunitRpcResult,
  ScopeIndexManifestSchema,
  WorkunitCurrentSourceSchema,
  WorkunitImplementationSchema,
  WorkunitSourceManifestSchema,
} from '@figma-agent/protocol';
import type { z } from 'zod';

import { SafeSessionWriter } from '../storage/safe-session-writer.js';
import type { SessionWorkspace } from '../storage/session-workspace.js';

const CACHE_ROOT = '.figma_bridge_agent';

interface FrontendContextStoreOptions {
  now?: () => Date;
  pluginVersion?: () => string | undefined;
}

interface WorkunitReadContext {
  current: ReturnType<typeof WorkunitCurrentSourceSchema.parse>;
  implementation: ReturnType<typeof WorkunitImplementationSchema.parse>;
}

/** 管理结构索引、不可变 workunit 来源和 Agent 拥有的实施账本。 */
export class FrontendContextStore {
  readonly #writer: SafeSessionWriter;
  readonly #now: () => Date;
  readonly #createdAt: string;
  readonly #pluginVersion: () => string | undefined;
  #sessionWrite?: Promise<void>;

  constructor(
    readonly workspace: SessionWorkspace,
    options: FrontendContextStoreOptions = {},
  ) {
    this.#writer = new SafeSessionWriter(workspace);
    this.#now = options.now ?? (() => new Date());
    this.#createdAt = this.#now().toISOString();
    this.#pluginVersion = options.pluginVersion ?? (() => undefined);
  }

  async writeIndex(result: IndexScopeRpcResult): Promise<IndexScopeResult> {
    this.workspace.beginWrite();
    await this.#ensureSessionFiles(result);
    const indexId = `index-${shortHash(result.rootNodeId)}`;
    const variant = `index-${shortHash(JSON.stringify(result.request))}`;
    const directory = `${sessionRoot(this.workspace.sessionId)}/indexes/${indexId}/${result.sourceFingerprint}/${variant}`;
    const outline = await this.#writer.write({
      relativePath: `${directory}/outline.jsonl`,
      data: result.outlineJsonl,
      writePolicy: 'REUSE_OR_FAIL',
    });
    const manifest = ScopeIndexManifestSchema.parse({
      schemaVersion: 3,
      kind: 'STRUCTURE_INDEX',
      sessionId: this.workspace.sessionId,
      indexId,
      rootNodeId: result.rootNodeId,
      rootNodeName: result.rootNodeName,
      page: result.page,
      request: result.request,
      sourceFingerprint: result.sourceFingerprint,
      nodeCount: result.nodeCount,
      structureComplete: result.complete,
      truncation: result.truncation,
      files: { outline: 'outline.jsonl' },
      sha256: { outline: outline.sha256 },
      createdAt: this.#createdAt,
    });
    const manifestFile = await this.#writer.write({
      relativePath: `${directory}/manifest.json`,
      data: jsonFile(manifest),
      writePolicy: 'REUSE_OR_FAIL',
    });
    return {
      indexManifestPath: manifestFile.projectRelativePath,
      sourceFingerprint: result.sourceFingerprint,
      structureComplete: result.complete,
      ...(result.truncation ? { truncation: result.truncation } : {}),
    };
  }

  async prepareWorkunit(
    result: PrepareWorkunitRpcResult,
    fidelityPolicy: z.infer<typeof FidelityPolicySchema>,
  ): Promise<PrepareWorkunitResult> {
    this.workspace.beginWrite();
    await this.#ensureSessionFiles(result);
    const factNodeIds = [...(result.request.factNodeIds ?? [])].sort();
    const normalizedRequest = { ...result.request, factNodeIds };
    const workUnitId = workunitKey(result.rootNodeId, factNodeIds);
    const variant = `source-${shortHash(JSON.stringify(normalizedRequest))}`;
    const workUnitDirectory = `${sessionRoot(this.workspace.sessionId)}/work-units/${workUnitId}`;
    const sourceDirectory = `${workUnitDirectory}/source/${result.sourceFingerprint}/${variant}`;

    const outline = await this.#writer.write({
      relativePath: `${sourceDirectory}/outline.jsonl`,
      data: result.outlineJsonl,
      writePolicy: 'REUSE_OR_FAIL',
    });
    const facts = await this.#writer.write({
      relativePath: `${sourceDirectory}/facts.jsonl`,
      data: result.factsJsonl,
      writePolicy: 'REUSE_OR_FAIL',
    });
    const preview = result.preview
      ? await this.#writer.write({
          relativePath: `${sourceDirectory}/preview.png`,
          data: decodePng(result.preview.data),
          writePolicy: 'REUSE_OR_FAIL',
        })
      : undefined;
    const manifest = WorkunitSourceManifestSchema.parse({
      schemaVersion: 3,
      kind: 'WORKUNIT_SOURCE',
      normalization: 'COMPACT_V2',
      sessionId: this.workspace.sessionId,
      workUnitId,
      rootNodeId: result.rootNodeId,
      rootNodeName: result.rootNodeName,
      page: result.page,
      request: normalizedRequest,
      sourceFingerprint: result.sourceFingerprint,
      nodeCount: result.nodeCount,
      evidenceComplete: result.complete,
      truncation: result.truncation,
      files: {
        outline: 'outline.jsonl',
        facts: 'facts.jsonl',
        ...(preview ? { preview: 'preview.png' as const } : {}),
      },
      sha256: {
        outline: outline.sha256,
        facts: facts.sha256,
        ...(preview ? { preview: preview.sha256 } : {}),
      },
      createdAt: this.#createdAt,
    });
    const manifestFile = await this.#writer.write({
      relativePath: `${sourceDirectory}/manifest.json`,
      data: jsonFile(manifest),
      writePolicy: 'REUSE_OR_FAIL',
    });

    const implementationPath = `${workUnitDirectory}/implementation.json`;
    const existingImplementation = await this.#readOptionalJson(implementationPath);
    let requiresMappingReview = false;
    if (existingImplementation === undefined) {
      await this.#writer.write({
        relativePath: implementationPath,
        data: jsonFile({
          sourceFingerprint: result.sourceFingerprint,
          fidelityPolicy,
          state: 'PLANNED',
          targetFiles: [],
          mappings: {},
          assumptions: [],
          unresolvedDifferences: [],
        }),
        writePolicy: 'REUSE_OR_FAIL',
      });
    } else {
      const implementation = WorkunitImplementationSchema.parse(existingImplementation.value);
      requiresMappingReview = implementation.sourceFingerprint !== result.sourceFingerprint;
    }

    const currentPath = `${workUnitDirectory}/source/current.json`;
    await this.#writeServerOwnedPointer(
      currentPath,
      WorkunitCurrentSourceSchema.parse({
        schemaVersion: 1,
        workUnitId,
        rootNodeId: result.rootNodeId,
        sourceFingerprint: result.sourceFingerprint,
        variant,
        manifestPath: manifestFile.projectRelativePath,
        updatedAt: this.#now().toISOString(),
      }),
    );
    return {
      workUnitId,
      workUnitPath: workUnitDirectory,
      sourceFingerprint: result.sourceFingerprint,
      evidenceComplete: result.complete,
      requiresMappingReview,
      ...(result.truncation ? { truncation: result.truncation } : {}),
    };
  }

  /** 新鲜度检查使用 implementation 中经 Agent 确认的来源指纹。 */
  async getCheckTarget(workUnitId: string): Promise<{
    rootNodeId: string;
    storedFingerprint: string;
  }> {
    const context = await this.#readWorkunit(workUnitId);
    return {
      rootNodeId: context.current.rootNodeId,
      storedFingerprint: context.implementation.sourceFingerprint,
    };
  }

  /** 素材导出只有在 Agent 已把映射复核到当前来源后才能继续。 */
  async resolveAssetSource(workUnitId: string): Promise<{
    rootNodeId: string;
    expectedSourceFingerprint: string;
  }> {
    const context = await this.#readWorkunit(workUnitId);
    if (context.implementation.sourceFingerprint !== context.current.sourceFingerprint) {
      throw new BridgeFault({
        code: 'WORKUNIT_SOURCE_STALE',
        message: 'Review workunit mappings and update implementation.json to the current source.',
        retryable: true,
        nodeId: context.current.rootNodeId,
      });
    }
    return {
      rootNodeId: context.current.rootNodeId,
      expectedSourceFingerprint: context.implementation.sourceFingerprint,
    };
  }

  async #readWorkunit(workUnitId: string): Promise<WorkunitReadContext> {
    if (!/^workunit-[a-f0-9]{16}$/.test(workUnitId)) throw workunitNotFound(workUnitId);
    const directory = `${sessionRoot(this.workspace.sessionId)}/work-units/${workUnitId}`;
    try {
      const [current, implementation] = await Promise.all([
        this.#readRequiredJson(`${directory}/source/current.json`),
        this.#readRequiredJson(`${directory}/implementation.json`),
      ]);
      return {
        current: WorkunitCurrentSourceSchema.parse(current),
        implementation: WorkunitImplementationSchema.parse(implementation),
      };
    } catch (error) {
      if (error instanceof BridgeFault) throw error;
      throw workunitNotFound(workUnitId);
    }
  }

  async #readRequiredJson(relativePath: string): Promise<unknown> {
    const existing = await this.#readOptionalJson(relativePath);
    if (!existing) throw new Error(`Missing ${relativePath}`);
    return existing.value;
  }

  async #readOptionalJson(
    relativePath: string,
  ): Promise<{ value: unknown; sha256: string } | undefined> {
    const status = this.workspace.beginWrite();
    const target = resolve(status.rootPath, ...relativePath.split('/'));
    assertContained(status.rootPath, target);
    try {
      const bytes = await readFile(target);
      return { value: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async #writeServerOwnedPointer(relativePath: string, value: unknown): Promise<void> {
    const existing = await this.#readOptionalJson(relativePath);
    const previous = WorkunitCurrentSourceSchema.safeParse(existing?.value);
    const next = WorkunitCurrentSourceSchema.safeParse(value);
    if (
      previous.success &&
      next.success &&
      previous.data.rootNodeId === next.data.rootNodeId &&
      previous.data.sourceFingerprint === next.data.sourceFingerprint &&
      previous.data.variant === next.data.variant &&
      previous.data.manifestPath === next.data.manifestPath
    ) {
      return;
    }
    await this.#writer.write({
      relativePath,
      data: jsonFile(value),
      writePolicy: existing ? 'OVERWRITE' : 'REUSE_OR_FAIL',
      ...(existing ? { expectedExistingSha256: existing.sha256 } : {}),
    });
  }

  async #ensureSessionFiles(result: IndexScopeRpcResult | PrepareWorkunitRpcResult): Promise<void> {
    this.#sessionWrite ??= this.#writeSessionFiles(result);
    await this.#sessionWrite;
  }

  async #writeSessionFiles(result: IndexScopeRpcResult | PrepareWorkunitRpcResult): Promise<void> {
    await this.#writer.write({
      relativePath: `${CACHE_ROOT}/.gitignore`,
      data: '*\n',
      writePolicy: 'REUSE_OR_FAIL',
    });
    const status = this.workspace.beginWrite();
    await this.#writer.write({
      relativePath: `${sessionRoot(this.workspace.sessionId)}/session.json`,
      data: jsonFile({
        schemaVersion: 1,
        sessionId: this.workspace.sessionId,
        workspaceRoot: status.rootPath,
        document: result.document,
        page: result.page,
        ...(this.#pluginVersion() ? { pluginVersion: this.#pluginVersion() } : {}),
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        createdAt: this.#createdAt,
      }),
      writePolicy: 'REUSE_OR_FAIL',
    });
  }
}

function sessionRoot(sessionId: string): string {
  return `${CACHE_ROOT}/sessions/${sessionId}`;
}

function workunitKey(rootNodeId: string, factNodeIds: readonly string[]): string {
  return `workunit-${shortHash(JSON.stringify({ rootNodeId, factNodeIds }))}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function decodePng(data: string): Uint8Array {
  const bytes = Buffer.from(data, 'base64');
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Workunit preview is not a valid PNG payload.');
  }
  return bytes;
}

function assertContained(root: string, target: string): void {
  const remaining = relative(root, target);
  if (remaining === '' || (!remaining.startsWith('..') && !isAbsolute(remaining))) return;
  throw new Error(`Path escapes workspace: ${target}`);
}

function workunitNotFound(workUnitId: string): BridgeFault {
  return new BridgeFault({
    code: 'WORKUNIT_NOT_FOUND',
    message: `Workunit does not exist in the current session: ${workUnitId}`,
    retryable: false,
  });
}
