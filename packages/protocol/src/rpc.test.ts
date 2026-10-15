import { describe, expect, it } from 'vitest';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';
import { RpcRequestSchema } from './rpc.js';

describe('桥接线协议版本', () => {
  it('固定为 11，并明确拒绝协议 10 请求', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(11);
    expect(
      RpcRequestSchema.safeParse({ version: 11, id: 'request-1', method: 'status' }).success,
    ).toBe(true);
    expect(
      RpcRequestSchema.safeParse({ version: 10, id: 'request-1', method: 'status' }).success,
    ).toBe(false);
  });
});
