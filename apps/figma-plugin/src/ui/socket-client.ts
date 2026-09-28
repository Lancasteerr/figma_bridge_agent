import {
  AuthChallengeSchema,
  AuthRejectedSchema,
  AuthServerProofSchema,
  BRIDGE_PROTOCOL_VERSION,
  RpcRequestSchema,
} from '@figma-agent/protocol';

import type { PluginAuth } from '../shared/messages.js';
import { createPluginProof, createServerProof, equalProof, randomNonce } from './auth.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticated';

const BRIDGE_URL = 'ws://localhost:3900';

/** UI 线程的已配对连接；认证失效时停止重试并要求用户重新配对。 */
export class BridgeSocketClient {
  readonly #onState: (state: ConnectionState) => void;
  readonly #onRequest: (request: unknown) => void;
  readonly #onAuthInvalid: (reason: string) => void;
  #socket: WebSocket | undefined;
  #auth: PluginAuth | undefined;
  #retry = 0;
  #retryTimer: number | undefined;
  #generation = 0;

  constructor(
    onState: (state: ConnectionState) => void,
    onRequest: (request: unknown) => void,
    onAuthInvalid: (reason: string) => void,
  ) {
    this.#onState = onState;
    this.#onRequest = onRequest;
    this.#onAuthInvalid = onAuthInvalid;
  }

  start(auth: PluginAuth): void {
    if (
      auth.deviceId === this.#auth?.deviceId &&
      auth.serverId === this.#auth?.serverId &&
      (this.#socket?.readyState === WebSocket.CONNECTING ||
        this.#socket?.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    this.stop();
    this.#auth = auth;
    this.#generation += 1;
    this.#connect(this.#generation);
  }

  stop(): void {
    this.#generation += 1;
    if (this.#retryTimer !== undefined) window.clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#socket?.close();
    this.#socket = undefined;
    this.#auth = undefined;
    this.#onState('disconnected');
  }

  send(value: unknown): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(value));
  }

  #connect(generation: number): void {
    const auth = this.#auth;
    if (generation !== this.#generation || !auth) return;
    this.#onState('connecting');
    const socket = new WebSocket(BRIDGE_URL);
    this.#socket = socket;
    let authenticated = false;
    let serverNonce = '';
    let pluginNonce = '';
    let terminal = false;

    socket.onmessage = (event) => {
      try {
        const value: unknown = JSON.parse(String(event.data));
        if (!authenticated) {
          const challenge = AuthChallengeSchema.safeParse(value);
          if (challenge.success) {
            if (challenge.data.serverId !== auth.serverId) {
              terminal = true;
              this.#onAuthInvalid('The local bridge identity changed. Pair this plugin again.');
              socket.close(4003, 'SERVER_CHANGED');
              return;
            }
            serverNonce = challenge.data.serverNonce;
            pluginNonce = randomNonce();
            socket.send(
              JSON.stringify({
                type: 'auth.plugin-proof',
                protocolVersion: BRIDGE_PROTOCOL_VERSION,
                serverId: auth.serverId,
                deviceId: auth.deviceId,
                serverNonce,
                pluginNonce,
                proof: createPluginProof(
                  auth.token,
                  auth.serverId,
                  auth.deviceId,
                  serverNonce,
                  pluginNonce,
                ),
                pluginVersion: '0.2.0',
              }),
            );
            return;
          }
          const proof = AuthServerProofSchema.safeParse(value);
          if (proof.success) {
            const expected = createServerProof(
              auth.token,
              auth.serverId,
              auth.deviceId,
              serverNonce,
              pluginNonce,
            );
            if (
              proof.data.serverId !== auth.serverId ||
              proof.data.deviceId !== auth.deviceId ||
              !equalProof(proof.data.proof, expected)
            ) {
              terminal = true;
              this.#onAuthInvalid('The local bridge proof was invalid. Pair this plugin again.');
              socket.close(4003, 'AUTH_FAILED');
              return;
            }
            authenticated = true;
            this.#retry = 0;
            this.#onState('authenticated');
            return;
          }
          const rejection = AuthRejectedSchema.safeParse(value);
          if (rejection.success) {
            terminal = rejection.data.code !== 'PLUGIN_ALREADY_CONNECTED';
            if (terminal) this.#onAuthInvalid(rejection.data.message);
            socket.close(4003, rejection.data.code);
          }
          return;
        }

        const request = RpcRequestSchema.safeParse(value);
        if (request.success) this.#onRequest(request.data);
      } catch (error) {
        console.error('[Figma bridge] Failed to process bridge message.', error);
        socket.close(4002, 'Invalid bridge message');
      }
    };

    socket.onclose = (event) => {
      if (generation !== this.#generation || this.#socket !== socket) return;
      this.#socket = undefined;
      if (event.code !== 1000 && event.code !== 1001) {
        console.warn(
          `[Figma bridge] WebSocket closed (${event.code || 'no-code'}): ${event.reason || 'no reason'}`,
        );
      }
      this.#onState('disconnected');
      if (!terminal && this.#auth) this.#scheduleReconnect(generation);
    };
    socket.onerror = () => socket.close();
  }

  #scheduleReconnect(generation: number): void {
    const base = Math.min(10_000, 500 * 2 ** this.#retry);
    this.#retry += 1;
    const delay = base + Math.floor(Math.random() * 250);
    this.#retryTimer = window.setTimeout(() => this.#connect(generation), delay);
  }
}
