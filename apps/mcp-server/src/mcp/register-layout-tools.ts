import {
  ApplyLayoutPlanInputSchema,
  LayoutPlanApplyResultSchema,
  LayoutPlanValidationResultSchema,
  ValidateLayoutPlanInputSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import { structuredResult, toolError } from './result.js';

/** 注册布局计划的只读验证和长超时原子应用工具。 */
export function registerLayoutTools(server: McpServer, broker: BridgeTransport): void {
  server.registerTool(
    'figma_validate_layout_plan',
    {
      description:
        'Validate a declarative LayoutPlan without modifying Figma. A valid result contains a single-use ID that expires after five minutes.',
      inputSchema: ValidateLayoutPlanInputSchema,
      outputSchema: LayoutPlanValidationResultSchema,
      annotations: {
        title: 'Validate Figma Layout Plan',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ValidateLayoutPlanInputSchema.parse(input);
        return structuredResult(
          LayoutPlanValidationResultSchema.parse(
            await broker.request('validateLayoutPlan', parsed, 15_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_apply_layout_plan',
    {
      description:
        'Atomically clone source nodes and apply a previously validated LayoutPlan. The original source is never modified.',
      inputSchema: ApplyLayoutPlanInputSchema,
      outputSchema: LayoutPlanApplyResultSchema,
      annotations: {
        title: 'Apply Figma Layout Plan',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ApplyLayoutPlanInputSchema.parse(input);
        return structuredResult(
          LayoutPlanApplyResultSchema.parse(
            await broker.request('applyLayoutPlan', parsed, 120_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
