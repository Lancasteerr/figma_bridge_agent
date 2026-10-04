import {
  ApplyDesignPlanInputSchema,
  DesignPlanApplyResultSchema,
  DesignPlanValidationResultSchema,
  ValidateDesignPlanInputSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import { structuredResult, toolError } from './result.js';

/** 注册 DesignPlan 的只读验证和原子应用入口。 */
export function registerDesignTools(server: McpServer, broker: BridgeTransport): void {
  server.registerTool(
    'figma_validate_design_plan',
    {
      description:
        'Validate a complete declarative DesignPlan without modifying Figma. The root is an isolated Proposal Frame, not a Figma Page. TEXT uses text.font.requested, CLONE uses sourceNodeId, and INSTANCE uses source { mode, nodeId }. A valid result contains a single-use ID that expires after five minutes.',
      inputSchema: ValidateDesignPlanInputSchema,
      outputSchema: DesignPlanValidationResultSchema,
      annotations: {
        title: 'Validate Figma Design Plan',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ValidateDesignPlanInputSchema.parse(input);
        return structuredResult(
          DesignPlanValidationResultSchema.parse(
            await broker.request('validateDesignPlan', parsed, 30_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_apply_design_plan',
    {
      description:
        'Atomically create a complete isolated Proposal from a previously validated DesignPlan.',
      inputSchema: ApplyDesignPlanInputSchema,
      outputSchema: DesignPlanApplyResultSchema,
      annotations: {
        title: 'Apply Figma Design Plan',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ApplyDesignPlanInputSchema.parse(input);
        return structuredResult(
          DesignPlanApplyResultSchema.parse(
            await broker.request('applyDesignPlan', parsed, 120_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
