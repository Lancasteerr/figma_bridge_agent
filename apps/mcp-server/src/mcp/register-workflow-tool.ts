import {
  ActivateWorkflowInputSchema,
  ActivateWorkflowResultSchema,
  type Workflow,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

export const INSPECT_TOOL_NAMES = [
  'figma_inspect_browse_nodes',
  'figma_inspect_read_node_facts',
  'figma_inspect_render_preview',
  'figma_inspect_read_css_hint',
  'figma_inspect_read_raw_fields',
  'figma_inspect_read_design_resources',
  'figma_inspect_list_fonts',
] as const;

export const FRONTEND_TOOL_NAMES = [
  ...INSPECT_TOOL_NAMES,
  'figma_frontend_bind_workspace',
  'figma_export_semantic_scope',
  'figma_check_semantic_scope',
  'figma_frontend_export_assets',
] as const;

export const DESIGN_TOOL_NAMES = [
  ...INSPECT_TOOL_NAMES,
  'figma_design_read_source_fingerprint',
  'figma_design_stage_asset',
  'figma_design_duplicate_as_proposal',
  'figma_design_create_frame',
  'figma_design_reparent_nodes',
  'figma_design_set_layout',
  'figma_design_update_text',
  'figma_design_set_instance_properties',
  'figma_design_create_component_from_node',
  'figma_design_discard_proposal',
  'figma_design_validate_plan',
  'figma_design_apply_plan',
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
