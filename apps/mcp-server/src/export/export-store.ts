import type { AssetExportStatus } from '@figma-agent/protocol';

import {
  SafeSessionWriter,
  type SessionWriteRequest,
  type SessionWriteResult,
} from '../storage/safe-session-writer.js';
import { SessionWorkspace, type SessionWorkspaceOptions } from '../storage/session-workspace.js';

export type ExportWriteRequest = SessionWriteRequest;
export type ExportWriteResult = SessionWriteResult;
export type ExportStoreOptions = SessionWorkspaceOptions & { workspace?: SessionWorkspace };

/** 素材导出适配器；目录生命周期和安全写入由共享会话存储负责。 */
export class ExportStore {
  readonly workspace: SessionWorkspace;
  readonly #writer: SafeSessionWriter;

  constructor(options: ExportStoreOptions = {}) {
    this.workspace = options.workspace ?? new SessionWorkspace(options);
    this.#writer = new SafeSessionWriter(this.workspace);
  }

  get sessionId(): string {
    return this.workspace.sessionId;
  }

  get status(): AssetExportStatus {
    return this.workspace.status;
  }

  async initialize(): Promise<void> {
    await this.workspace.initialize();
  }

  async bindRoot(rootPath: string, expectedSessionId: string): Promise<AssetExportStatus> {
    return await this.workspace.bindRoot(rootPath, expectedSessionId);
  }

  async write(request: ExportWriteRequest): Promise<ExportWriteResult> {
    return await this.#writer.write(request);
  }
}
