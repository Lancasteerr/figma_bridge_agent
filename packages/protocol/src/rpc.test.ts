import { describe, expect, it } from 'vitest';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';
import { RpcRequestSchema } from './rpc.js';

describe('桥接线协议版本', () => {
  it('固定为 12，并明确拒绝不支持原位编辑错误码的协议 11 请求', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(12);
    expect(
      RpcRequestSchema.safeParse({ version: 12, id: 'request-1', method: 'status' }).success,
    ).toBe(true);
    expect(
      RpcRequestSchema.safeParse({ version: 11, id: 'request-1', method: 'status' }).success,
    ).toBe(false);
  });
});
