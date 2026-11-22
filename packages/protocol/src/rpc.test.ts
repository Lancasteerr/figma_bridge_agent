import { describe, expect, it } from 'vitest';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';
import { RpcRequestSchema } from './rpc.js';

describe('桥接线协议版本', () => {
  it('固定为 13，并拒绝不支持 PAGE 导航结构的旧协议请求', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(13);
    expect(
      RpcRequestSchema.safeParse({ version: 13, id: 'request-1', method: 'status' }).success,
    ).toBe(true);
    expect(
      RpcRequestSchema.safeParse({ version: 11, id: 'request-1', method: 'status' }).success,
    ).toBe(false);
    expect(
      RpcRequestSchema.safeParse({ version: 12, id: 'request-1', method: 'status' }).success,
    ).toBe(false);
  });
});
