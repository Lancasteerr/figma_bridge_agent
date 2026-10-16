import {
  ApplyDesignPlanInputSchema,
  DesignPlanApplyResultSchema,
  DesignPlanValidationResultSchema,
  ValidateDesignPlanInputSchema,
  ValidateDesignPlanToolInputSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

/** 注册 DesignPlan 的只读验证和原子应用入口。 */
export function registerDesignTools(
  server: McpServer,
  broker: BridgeTransport,
): RegisteredToolMap {
  const tools: RegisteredToolMap = {};
  tools.figma_validate_design_plan = server.registerTool(
    'figma_validate_design_plan',
    {
      description:
        'Validate a complete declarative DesignPlan without modifying Figma. Optional returnRefs selects up to 200 node or resource mappings for apply; it is not part of the plan digest. A valid result contains a single-use ID that expires after five minutes.',
      inputSchema: ValidateDesignPlanToolInputSchema,
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
        const publicInput = ValidateDesignPlanToolInputSchema.parse(input);
        // 公开 schema 只控制工具体积，内部边界仍拒绝不完整或非法计划。
        const parsed = ValidateDesignPlanInputSchema.parse(publicInput);
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

  tools.figma_apply_design_plan = server.registerTool(
    'figma_apply_design_plan',
    {
      description:
        'Atomically create a complete isolated Proposal from a previously validated DesignPlan. refMap is omitted unless returnRefs were requested during validation.',
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
  return tools;
}
