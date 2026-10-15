import { describe, expect, it } from 'vitest';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';
import { RpcRequestSchema } from './rpc.js';

describe('桥接线协议版本', () => {
  it('固定为 10，并明确拒绝 2.9.2 的协议 9 请求', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(10);
    expect(
      RpcRequestSchema.safeParse({ version: 10, id: 'request-1', method: 'status' }).success,
    ).toBe(true);
    expect(
      RpcRequestSchema.safeParse({ version: 9, id: 'request-1', method: 'status' }).success,
    ).toBe(false);
  });
});
