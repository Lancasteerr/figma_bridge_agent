import { BRIDGE_PROTOCOL_VERSION } from '@figma-agent/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BridgeSocketClient } from '../src/ui/socket-client.js';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  emitClose(code = 1006, reason = 'test close'): void {
    this.onclose?.({ code, reason } as CloseEvent);
  }

  emitMessage(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}

describe('BridgeSocketClient connection lifecycle', () => {
  const setTimeoutMock = vi.fn(() => 1);
  const auth = {
    version: 2 as const,
    serverId: '11111111-1111-4111-8111-111111111111',
    deviceId: '22222222-2222-4222-8222-222222222222',
    token: Buffer.alloc(32, 7).toString('base64url'),
  };

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    setTimeoutMock.mockClear();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('window', {
      clearTimeout: vi.fn(),
      setTimeout: setTimeoutMock,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not open a second socket when Main echoes the same saved secret', () => {
    const states: string[] = [];
    const client = new BridgeSocketClient(
      (state) => states.push(state),
      () => undefined,
      () => undefined,
    );

    client.start(auth);
    client.start(auth);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://localhost:3900');
    expect(states).toEqual(['disconnected', 'connecting']);
  });

  it('ignores a close event from a socket replaced by a newer generation', () => {
    const states: string[] = [];
    const client = new BridgeSocketClient(
      (state) => states.push(state),
      () => undefined,
      () => undefined,
    );

    client.start(auth);
    const staleSocket = FakeWebSocket.instances[0];
    client.start({ ...auth, deviceId: '33333333-3333-4333-8333-333333333333' });
    staleSocket?.emitClose();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(states.at(-1)).toBe('connecting');
    expect(setTimeoutMock).not.toHaveBeenCalled();
  });

  it('keeps the credential and retries while release versions differ', () => {
    const onAuthInvalid = vi.fn();
    const client = new BridgeSocketClient(
      () => undefined,
      () => undefined,
      onAuthInvalid,
    );

    client.start(auth);
    const socket = FakeWebSocket.instances[0];
    socket?.emitMessage({
      type: 'auth.challenge',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      serverVersion: '0.0.0',
      serverId: auth.serverId,
      serverNonce: Buffer.alloc(24, 9).toString('base64url'),
    });
    socket?.emitClose(4003, 'VERSION_MISMATCH');

    expect(onAuthInvalid).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledOnce();
  });
});
