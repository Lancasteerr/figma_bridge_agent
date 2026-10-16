import {
  ActivateWorkflowInputSchema,
  ActivateWorkflowResultSchema,
  type Workflow,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

export const INSPECT_TOOL_NAMES = [
  'figma_get_tree',
  'figma_get_node',
  'figma_render_node',
  'figma_get_css',
  'figma_get_raw_node',
  'figma_get_design_resources',
  'figma_list_fonts',
] as const;

export const FRONTEND_TOOL_NAMES = [
  ...INSPECT_TOOL_NAMES,
  'figma_bind_export_root',
  'figma_export_semantic_scope',
  'figma_check_semantic_scope',
  'figma_export_assets',
] as const;

export const DESIGN_TOOL_NAMES = [
  ...INSPECT_TOOL_NAMES,
  'figma_get_fingerprint',
  'figma_stage_asset',
  'figma_duplicate_as_proposal',
  'figma_create_frame',
  'figma_reparent_nodes',
  'figma_set_layout',
  'figma_update_text',
  'figma_set_instance_properties',
  'figma_create_component_from_node',
  'figma_discard_proposal',
  'figma_validate_design_plan',
  'figma_apply_design_plan',
] as const;

const WORKFLOW_TOOLS: Record<Workflow, readonly string[]> = {
  INSPECT: INSPECT_TOOL_NAMES,
  FRONTEND: FRONTEND_TOOL_NAMES,
  DESIGN: DESIGN_TOOL_NAMES,
};

/** 注册连接级工作流开关；切换只改变 MCP 工具可见性。 */
export function registerWorkflowActivationTool(
  server: McpServer,
  workflowTools: RegisteredToolMap,
): RegisteredToolMap {
  // 冷启动阶段不暴露任何专用工具，SDK 会在后续切换时发送 list_changed。
  for (const tool of Object.values(workflowTools)) tool.disable();

  const tools: RegisteredToolMap = {};
  tools.figma_activate_workflow = server.registerTool(
    'figma_activate_workflow',
    {
      description:
        'Enable exactly the MCP tools needed for INSPECT, FRONTEND, or DESIGN work on this connection. Switching workflows disables the previous workflow-specific tools.',
      inputSchema: ActivateWorkflowInputSchema,
      outputSchema: ActivateWorkflowResultSchema,
      annotations: {
        title: 'Activate Figma workflow',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const { workflow } = ActivateWorkflowInputSchema.parse(input);
        const enabled = new Set(WORKFLOW_TOOLS[workflow]);
        for (const [name, tool] of Object.entries(workflowTools)) {
          const shouldEnable = enabled.has(name);
          // 跳过无变化句柄，保证重复激活不会产生多余通知。
          if (tool.enabled === shouldEnable) continue;
          if (shouldEnable) tool.enable();
          else tool.disable();
        }
        return structuredResult(
          ActivateWorkflowResultSchema.parse({
            workflow,
            enabledTools: ['figma_status', 'figma_activate_workflow', ...enabled].sort(),
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
  return tools;
}
