import {
  BRIDGE_PROTOCOL_VERSION,
  derivePairingMaterial,
  PairingCompleteSchema,
  PairingReadySchema,
  PairingRejectedSchema,
  PairingServerHelloSchema,
  pairingTranscript,
  x25519,
} from '@figma-agent/protocol';

import type { PluginAuth } from '../shared/messages.js';
import {
  decodeBase64Url,
  encodeBase64Url,
  equalProof,
  randomBytes,
  randomNonce,
  randomUuid,
} from './auth.js';

export type PairingViewState =
  { state: 'waiting' } | { state: 'code'; sas: string } | { state: 'error'; message: string };

const PAIR_URL = 'ws://localhost:3900/pair';

/** 未配对时自动探测显式开启的短时会话；凭据只在服务端确认完成后持久化。 */
export class PairingClient {
  readonly #onState: (state: PairingViewState) => void;
  readonly #onPaired: (auth: PluginAuth) => void;
  #socket: WebSocket | undefined;
  #retryTimer: number | undefined;
  #wanted = false;
  #generation = 0;
  #pending:
    { auth: PluginAuth; sessionId: string; confirmationProof: string; sas: string } | undefined;

  constructor(onState: (state: PairingViewState) => void, onPaired: (auth: PluginAuth) => void) {
    this.#onState = onState;
    this.#onPaired = onPaired;
  }

  start(): void {
    this.stop();
    this.#wanted = true;
    this.#generation += 1;
    this.#onState({ state: 'waiting' });
    this.#connect(this.#generation);
  }

  stop(): void {
    this.#wanted = false;
    this.#generation += 1;
    if (this.#retryTimer !== undefined) window.clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#socket?.close();
    this.#socket = undefined;
    this.#pending = undefined;
  }

  confirm(): void {
    const pending = this.#pending;
    const socket = this.#socket;
    if (!pending || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'pair.confirm',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        sessionId: pending.sessionId,
        deviceId: pending.auth.deviceId,
        proof: pending.confirmationProof,
      }),
    );
  }

  cancel(): void {
    this.stop();
    this.#onState({ state: 'error', message: 'Pairing cancelled. Run pair again or click Retry.' });
  }

  #connect(generation: number): void {
    if (!this.#wanted || generation !== this.#generation) return;
    const socket = new WebSocket(PAIR_URL);
    this.#socket = socket;
    let retry = true;

    socket.onmessage = (event) => {
      try {
        const value: unknown = JSON.parse(String(event.data));
        const hello = PairingServerHelloSchema.safeParse(value);
        if (hello.success) {
          const privateKey = randomBytes(32);
          const publicKey = encodeBase64Url(x25519.getPublicKey(privateKey));
          const deviceId = randomUuid();
          const pluginNonce = randomNonce();
          const transcript = pairingTranscript({
            serverId: hello.data.serverId,
            sessionId: hello.data.sessionId,
            serverNonce: hello.data.serverNonce,
            serverPublicKey: hello.data.serverPublicKey,
            deviceId,
            pluginNonce,
            pluginPublicKey: publicKey,
          });
          const material = derivePairingMaterial(
            privateKey,
            decodeBase64Url(hello.data.serverPublicKey),
            transcript,
          );
          privateKey.fill(0);
          this.#pending = {
            auth: {
              version: 2,
              serverId: hello.data.serverId,
              deviceId,
              token: encodeBase64Url(material.token),
            },
            sessionId: hello.data.sessionId,
            confirmationProof: encodeBase64Url(material.confirmationProof),
            sas: material.sas,
          };
          socket.send(
            JSON.stringify({
              type: 'pair.plugin-hello',
              protocolVersion: BRIDGE_PROTOCOL_VERSION,
              sessionId: hello.data.sessionId,
              deviceId,
              pluginNonce,
              pluginPublicKey: publicKey,
              pluginVersion: __PLUGIN_VERSION__,
            }),
          );
          return;
        }

        const ready = PairingReadySchema.safeParse(value);
        if (ready.success) {
          const pending = this.#pending;
          if (
            !pending ||
            ready.data.sessionId !== pending.sessionId ||
            ready.data.serverId !== pending.auth.serverId ||
            !equalProof(ready.data.sas, pending.sas)
          ) {
            retry = false;
            this.#onState({ state: 'error', message: 'Pairing verification failed.' });
            socket.close(4003, 'PAIRING_MISMATCH');
            return;
          }
          this.#onState({ state: 'code', sas: pending.sas });
          return;
        }

        const complete = PairingCompleteSchema.safeParse(value);
        if (
          complete.success &&
          this.#pending &&
          complete.data.sessionId === this.#pending.sessionId &&
          complete.data.serverId === this.#pending.auth.serverId
        ) {
          const auth = this.#pending.auth;
          retry = false;
          this.stop();
          this.#onPaired(auth);
          return;
        }

        const rejection = PairingRejectedSchema.safeParse(value);
        if (rejection.success) {
          const temporary =
            rejection.data.code === 'PAIRING_DISABLED' || rejection.data.code === 'PAIRING_BUSY';
          retry = temporary;
          if (!temporary) this.#onState({ state: 'error', message: rejection.data.message });
          socket.close(4003, rejection.data.code);
        }
      } catch (error) {
        retry = false;
        this.#onState({
          state: 'error',
          message: error instanceof Error ? error.message : 'Invalid pairing message.',
        });
        socket.close(4002, 'INVALID_MESSAGE');
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.#socket === socket) this.#socket = undefined;
      if (retry && this.#wanted && generation === this.#generation) {
        this.#retryTimer = window.setTimeout(() => this.#connect(generation), 1_500);
      }
    };
  }
}
