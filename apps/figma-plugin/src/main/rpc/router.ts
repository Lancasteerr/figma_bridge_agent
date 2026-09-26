import {
  BRIDGE_PROTOCOL_VERSION,
  RpcRequestSchema,
  toBridgeError,
  type RpcRequest,
  type RpcResponse,
} from '@figma-agent/protocol';

type Handler = (params: unknown) => unknown | Promise<unknown>;

export class RpcRouter {
  readonly #handlers = new Map<string, Handler>();

  register(method: string, handler: Handler): void {
    if (this.#handlers.has(method)) throw new Error(`Duplicate RPC method: ${method}`);
    this.#handlers.set(method, handler);
  }

  async route(raw: unknown): Promise<RpcResponse> {
    const parsed = RpcRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        version: BRIDGE_PROTOCOL_VERSION,
        id: this.#requestId(raw),
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Invalid RPC request.',
          retryable: false,
          details: parsed.error.flatten(),
        },
      };
    }
    return await this.#invoke(parsed.data);
  }

  async #invoke(request: RpcRequest): Promise<RpcResponse> {
    const handler = this.#handlers.get(request.method);
    if (!handler) {
      return {
        version: BRIDGE_PROTOCOL_VERSION,
        id: request.id,
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: `Unknown RPC method: ${request.method}`,
          retryable: false,
        },
      };
    }
    try {
      const result = await handler(request.params);
      return { version: BRIDGE_PROTOCOL_VERSION, id: request.id, ok: true, result };
    } catch (error) {
      return {
        version: BRIDGE_PROTOCOL_VERSION,
        id: request.id,
        ok: false,
        error: toBridgeError(error),
      };
    }
  }

  #requestId(raw: unknown): string {
    if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string') return raw.id;
    return 'invalid-request';
  }
}

