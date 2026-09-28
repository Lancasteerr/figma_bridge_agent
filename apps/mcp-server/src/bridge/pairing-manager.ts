import { randomBytes, randomUUID } from 'node:crypto';

import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeFault,
  derivePairingMaterial,
  MAX_PAIRED_CLIENTS,
  PAIRING_SESSION_TTL_MS,
  PairingConfirmSchema,
  PairingPluginHelloSchema,
  pairingTranscript,
  x25519,
} from '@figma-agent/protocol';
import { WebSocket, type RawData } from 'ws';

import { defaultConfigPath } from '../config/paths.js';
import { updateConfig, type ServerConfig } from '../config/store.js';
import { verifyProof } from '../security/proof.js';

export type PairingStatus =
  | { state: 'idle' }
  | { state: 'waiting-plugin'; sessionId: string; expiresAt: number }
  | { state: 'awaiting-confirmation'; sessionId: string; expiresAt: number; sas: string }
  | { state: 'paired'; deviceId: string }
  | { state: 'expired' }
  | { state: 'cancelled' };

interface ActiveSession {
  sessionId: string;
  expiresAt: number;
  serverNonce: string;
  privateKey: Uint8Array;
  publicKey: string;
  socket?: WebSocket;
  deviceId?: string;
  pluginVersion?: string;
  token?: string;
  sas?: string;
  confirmationProof?: string;
  timer: NodeJS.Timeout;
}

export class PairingManager {
  readonly #config: ServerConfig;
  readonly #configPath: string;
  readonly #log: (entry: Record<string, unknown>) => void;
  #active: ActiveSession | undefined;
  #terminal: PairingStatus = { state: 'idle' };

  constructor(
    config: ServerConfig,
    options: {
      configPath?: string;
      log?: (entry: Record<string, unknown>) => void;
    } = {},
  ) {
    this.#config = config;
    this.#configPath = options.configPath ?? defaultConfigPath();
    this.#log = options.log ?? (() => undefined);
  }

  start(): PairingStatus {
    if (this.#active && Date.now() < this.#active.expiresAt) {
      throw new BridgeFault({
        code: 'BUSY',
        message: 'A pairing session is already active.',
        retryable: true,
      });
    }
    if (Object.keys(this.#config.pairedClients).length >= MAX_PAIRED_CLIENTS) {
      throw new BridgeFault({
        code: 'LIMIT_EXCEEDED',
        message: `The ${MAX_PAIRED_CLIENTS}-device limit has been reached. Revoke an old device first.`,
        retryable: false,
      });
    }

    const privateKey = randomBytes(32);
    const sessionId = randomUUID();
    const expiresAt = Date.now() + PAIRING_SESSION_TTL_MS;
    this.#terminal = { state: 'idle' };
    const timer = setTimeout(() => this.#finish('expired'), PAIRING_SESSION_TTL_MS);
    this.#active = {
      sessionId,
      expiresAt,
      serverNonce: randomBytes(24).toString('base64url'),
      privateKey,
      publicKey: Buffer.from(x25519.getPublicKey(privateKey)).toString('base64url'),
      timer,
    };
    this.#log({ level: 'info', event: 'pairing_started', sessionId, expiresAt });
    return this.status;
  }

  get status(): PairingStatus {
    const session = this.#active;
    if (!session) return this.#terminal;
    if (session.sas) {
      return {
        state: 'awaiting-confirmation',
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        sas: session.sas,
      };
    }
    return { state: 'waiting-plugin', sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  get active(): boolean {
    return this.#active !== undefined;
  }

  cancel(): PairingStatus {
    this.#finish('cancelled');
    return this.status;
  }

  accept(socket: WebSocket): void {
    const session = this.#active;
    if (!session || Date.now() >= session.expiresAt) {
      this.#reject(socket, 'PAIRING_DISABLED', 'Run the pair command to open a pairing window.');
      return;
    }
    if (session.socket && session.socket.readyState !== WebSocket.CLOSED) {
      this.#reject(socket, 'PAIRING_BUSY', 'Another plugin is already pairing.');
      return;
    }
    session.socket = socket;
    socket.send(
      JSON.stringify({
        type: 'pair.server-hello',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        serverId: this.#config.serverId,
        sessionId: session.sessionId,
        serverNonce: session.serverNonce,
        serverPublicKey: session.publicKey,
        expiresAt: session.expiresAt,
      }),
    );
    socket.on('message', (data) => void this.#handleMessage(session, socket, data));
    socket.once('close', () => {
      if (this.#active === session && session.socket === socket) delete session.socket;
    });
  }

  stop(): void {
    if (this.#active) this.#finish('cancelled');
  }

  async #handleMessage(session: ActiveSession, socket: WebSocket, data: RawData): Promise<void> {
    if (this.#active !== session || socket !== session.socket) return;
    const value = this.#parseJson(data);
    if (!session.sas) {
      const hello = PairingPluginHelloSchema.safeParse(value);
      if (!hello.success || hello.data.sessionId !== session.sessionId) {
        this.#reject(socket, 'INVALID_MESSAGE', 'Invalid plugin pairing hello.');
        return;
      }
      try {
        const transcript = pairingTranscript({
          serverId: this.#config.serverId,
          sessionId: session.sessionId,
          serverNonce: session.serverNonce,
          serverPublicKey: session.publicKey,
          deviceId: hello.data.deviceId,
          pluginNonce: hello.data.pluginNonce,
          pluginPublicKey: hello.data.pluginPublicKey,
        });
        const material = derivePairingMaterial(
          session.privateKey,
          Buffer.from(hello.data.pluginPublicKey, 'base64url'),
          transcript,
        );
        session.deviceId = hello.data.deviceId;
        session.pluginVersion = hello.data.pluginVersion;
        session.token = Buffer.from(material.token).toString('base64url');
        session.sas = material.sas;
        session.confirmationProof = Buffer.from(material.confirmationProof).toString('base64url');
        socket.send(
          JSON.stringify({
            type: 'pair.ready',
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            serverId: this.#config.serverId,
            sessionId: session.sessionId,
            sas: material.sas,
          }),
        );
        this.#log({
          level: 'info',
          event: 'pairing_waiting_confirmation',
          sessionId: session.sessionId,
        });
      } catch {
        this.#reject(socket, 'INVALID_MESSAGE', 'Invalid pairing public key.');
      }
      return;
    }

    const confirmation = PairingConfirmSchema.safeParse(value);
    if (
      !confirmation.success ||
      confirmation.data.sessionId !== session.sessionId ||
      confirmation.data.deviceId !== session.deviceId ||
      !session.confirmationProof ||
      !verifyProof(confirmation.data.proof, session.confirmationProof)
    ) {
      this.#reject(socket, 'CONFIRMATION_FAILED', 'Pairing confirmation proof is not valid.');
      return;
    }

    const now = new Date().toISOString();
    const deviceId = session.deviceId;
    const token = session.token;
    const pluginVersion = session.pluginVersion;
    if (!deviceId || !token || !pluginVersion) {
      this.#reject(socket, 'INVALID_MESSAGE', 'Pairing session is incomplete.');
      return;
    }
    const updated = await updateConfig(
      (config) => ({
        ...config,
        pairedClients: {
          ...config.pairedClients,
          [deviceId]: { token, createdAt: now, lastSeenAt: now, pluginVersion },
        },
      }),
      this.#configPath,
    );
    Object.assign(this.#config, updated);
    socket.send(
      JSON.stringify({
        type: 'pair.complete',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        serverId: this.#config.serverId,
        sessionId: session.sessionId,
      }),
    );
    clearTimeout(session.timer);
    session.privateKey.fill(0);
    this.#active = undefined;
    this.#terminal = { state: 'paired', deviceId };
    this.#log({ level: 'info', event: 'pairing_completed', deviceId });
    socket.close(1000, 'Pairing completed');
  }

  #finish(state: 'expired' | 'cancelled'): void {
    const session = this.#active;
    if (session) {
      clearTimeout(session.timer);
      session.privateKey.fill(0);
      if (session.socket?.readyState === WebSocket.OPEN) {
        session.socket.send(
          JSON.stringify({
            type: 'pair.rejected',
            code: state === 'expired' ? 'PAIRING_EXPIRED' : 'PAIRING_CANCELLED',
            message: state === 'expired' ? 'Pairing window expired.' : 'Pairing was cancelled.',
          }),
        );
        session.socket.close(4000, state);
      }
    }
    this.#active = undefined;
    this.#terminal = { state };
    this.#log({ level: 'info', event: `pairing_${state}` });
  }

  #reject(
    socket: WebSocket,
    code: 'PAIRING_DISABLED' | 'PAIRING_BUSY' | 'INVALID_MESSAGE' | 'CONFIRMATION_FAILED',
    message: string,
  ): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'pair.rejected', code, message }));
      socket.close(4003, code);
    }
  }

  #parseJson(data: RawData): unknown {
    try {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : Buffer.concat(data).toString('utf8');
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
