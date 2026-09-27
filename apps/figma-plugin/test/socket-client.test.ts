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
}

describe('BridgeSocketClient connection lifecycle', () => {
  const setTimeoutMock = vi.fn(() => 1);

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
    );

    client.start('  same-secret-value  ');
    client.start('same-secret-value');

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://localhost:3900');
    expect(states).toEqual(['disconnected', 'connecting']);
  });

  it('ignores a close event from a socket replaced by a newer generation', () => {
    const states: string[] = [];
    const client = new BridgeSocketClient(
      (state) => states.push(state),
      () => undefined,
    );

    client.start('first-secret-value');
    const staleSocket = FakeWebSocket.instances[0];
    client.start('second-secret-value');
    staleSocket?.emitClose();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(states.at(-1)).toBe('connecting');
    expect(setTimeoutMock).not.toHaveBeenCalled();
  });
});
