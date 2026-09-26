import {
  AuthChallengeSchema,
  AuthRejectedSchema,
  AuthServerProofSchema,
  BRIDGE_PROTOCOL_VERSION,
  RpcRequestSchema,
} from '@figma-agent/protocol';

import { createPluginProof, createServerProof, equalProof, randomNonce } from './auth.js';

type ConnectionState = 'disconnected' | 'connecting' | 'authenticated';

export class BridgeSocketClient {
  readonly #onState: (state: ConnectionState) => void;
  readonly #onRequest: (request: unknown) => void;
  #socket: WebSocket | undefined;
  #secret = '';
  #retry = 0;
  #retryTimer: number | undefined;
  #generation = 0;

  constructor(onState: (state: ConnectionState) => void, onRequest: (request: unknown) => void) {
    this.#onState = onState;
    this.#onRequest = onRequest;
  }

  start(secret: string): void {
    this.stop();
    this.#secret = secret;
    this.#generation += 1;
    if (secret) this.#connect(this.#generation);
  }

  stop(): void {
    this.#generation += 1;
    if (this.#retryTimer !== undefined) window.clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#socket?.close();
    this.#socket = undefined;
    this.#onState('disconnected');
  }

  send(value: unknown): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(value));
  }

  #connect(generation: number): void {
    if (generation !== this.#generation) return;
    this.#onState('connecting');
    const socket = new WebSocket('ws://127.0.0.1:3900');
    this.#socket = socket;
    let authenticated = false;
    let serverNonce = '';
    let pluginNonce = '';

    socket.onmessage = (event) => {
      void (async () => {
        const value: unknown = JSON.parse(String(event.data));
        if (!authenticated) {
          const challenge = AuthChallengeSchema.safeParse(value);
          if (challenge.success) {
            serverNonce = challenge.data.serverNonce;
            pluginNonce = randomNonce();
            socket.send(
              JSON.stringify({
                type: 'auth.plugin-proof',
                protocolVersion: BRIDGE_PROTOCOL_VERSION,
                serverNonce,
                pluginNonce,
                proof: await createPluginProof(this.#secret, serverNonce, pluginNonce),
                pluginVersion: '0.1.0',
              }),
            );
            return;
          }
          const proof = AuthServerProofSchema.safeParse(value);
          if (proof.success) {
            const expected = await createServerProof(this.#secret, serverNonce, pluginNonce);
            if (!equalProof(proof.data.proof, expected)) {
              socket.close(4003, 'Server proof failed');
              return;
            }
            authenticated = true;
            this.#retry = 0;
            this.#onState('authenticated');
            return;
          }
          if (AuthRejectedSchema.safeParse(value).success) {
            this.#secret = '';
            socket.close(4003, 'Authentication rejected');
          }
          return;
        }

        const request = RpcRequestSchema.safeParse(value);
        if (request.success) this.#onRequest(request.data);
      })().catch(() => socket.close(4002, 'Invalid bridge message'));
    };

    socket.onclose = () => {
      if (this.#socket === socket) this.#socket = undefined;
      this.#onState('disconnected');
      if (this.#secret && generation === this.#generation) this.#scheduleReconnect(generation);
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

