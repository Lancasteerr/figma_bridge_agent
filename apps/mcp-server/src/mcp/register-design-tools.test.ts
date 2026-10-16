import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { registerDesignTools } from './register-design-tools.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
}>;

describe('figma_validate_design_plan MCP 工具', () => {
  it('公开 schema 接收通用 JSON 后仍以完整 DesignPlan schema 严格校验', async () => {
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool(name: string, _definition: unknown, handler: ToolHandler) {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;
    const broker = {
      request: vi.fn(async () => ({
        status: 'VALID',
        validationId: 'validation-1',
        expiresAt: '2026-10-16T12:00:00.000Z',
      })),
    } as unknown as BridgeTransport;
    registerDesignTools(server, broker);
    const validate = handlers.get('figma_validate_design_plan')!;

    const invalid = await validate({ plan: {} });
    expect(invalid.isError).toBe(true);
    expect(broker.request).not.toHaveBeenCalled();

    const plan = {
      version: 1,
      proposal: { name: 'Proposal' },
      root: {
        kind: 'FRAME',
        ref: 'root',
        name: 'Root',
        geometry: { width: 100, height: 100 },
        children: [],
      },
    };
    const valid = await validate({ plan, returnRefs: ['root'] });
    expect(valid.isError).not.toBe(true);
    expect(valid.structuredContent).toMatchObject({
      status: 'VALID',
      validationId: 'validation-1',
    });
    expect(broker.request).toHaveBeenCalledWith(
      'validateDesignPlan',
      expect.objectContaining({
        plan: expect.objectContaining({ version: 1 }),
        returnRefs: ['root'],
      }),
      30_000,
    );
  });
});
