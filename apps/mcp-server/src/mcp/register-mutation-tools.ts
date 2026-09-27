import {
  CreateFrameInputSchema,
  CreateComponentInputSchema,
  CreateComponentResultSchema,
  DiscardProposalInputSchema,
  DiscardProposalResultSchema,
  DuplicateProposalInputSchema,
  MutationResultSchema,
  ProposalResultSchema,
  ReparentNodesInputSchema,
  SetLayoutInputSchema,
  SetInstancePropertiesInputSchema,
  UpdateTextInputSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { structuredResult, toolError } from './result.js';

/** 注册所有 Proposal 内部写操作，并为每个工具声明输入、输出和 destructive hints。 */
export function registerMutationTools(server: McpServer, broker: PluginConnectionBroker): void {
  server.registerTool(
    'figma_duplicate_as_proposal',
    {
      description:
        'Clone the supplied current-page nodes, or the current selection, into a bridge-marked Proposal beside the original. The original is never modified.',
      inputSchema: DuplicateProposalInputSchema,
      outputSchema: ProposalResultSchema,
      annotations: {
        title: 'Duplicate as Figma Proposal',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = DuplicateProposalInputSchema.parse(input);
        return structuredResult(
          ProposalResultSchema.parse(await broker.request('duplicateAsProposal', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_create_frame',
    {
      description:
        'Create one ordinary Frame inside a bridge-marked Proposal. Original design nodes are rejected.',
      inputSchema: CreateFrameInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Create Frame in Proposal',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = CreateFrameInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('createFrame', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_reparent_nodes',
    {
      description:
        'Move nodes within one bridge-marked Proposal. FLOW participates in Auto Layout; ABSOLUTE stays outside the layout flow.',
      inputSchema: ReparentNodesInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Reparent Proposal nodes',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ReparentNodesInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('reparentNodes', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_set_layout',
    {
      description:
        'Set Auto Layout, padding, gap, alignment, sizing, or absolute positioning on a node inside one Proposal.',
      inputSchema: SetLayoutInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Set Proposal layout',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = SetLayoutInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('setLayout', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_create_component_from_node',
    {
      description:
        'Convert a Frame inside a Proposal into a Component while preserving the Proposal marker when the root is replaced.',
      inputSchema: CreateComponentInputSchema,
      outputSchema: CreateComponentResultSchema,
      annotations: {
        title: 'Create Component From Proposal Node',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = CreateComponentInputSchema.parse(input);
        return structuredResult(
          CreateComponentResultSchema.parse(
            await broker.request('createComponentFromNode', parsed, 30_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_set_instance_properties',
    {
      description:
        'Set exposed text, boolean, variant, or instance-swap properties on an Instance inside a Proposal without detaching it.',
      inputSchema: SetInstancePropertiesInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Set Instance Properties',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = SetInstancePropertiesInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('setInstanceProperties', parsed, 30_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_update_text',
    {
      description:
        'Atomically update text inside a Proposal after preloading every required font. Missing fonts leave the node unchanged.',
      inputSchema: UpdateTextInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Update Proposal Text',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = UpdateTextInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('updateText', parsed, 30_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_discard_proposal',
    {
      description:
        'Delete an unchanged bridge-created Proposal. The expected fingerprint prevents deleting a Proposal edited after inspection.',
      inputSchema: DiscardProposalInputSchema,
      outputSchema: DiscardProposalResultSchema,
      annotations: {
        title: 'Discard Figma Proposal',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = DiscardProposalInputSchema.parse(input);
        return structuredResult(
          DiscardProposalResultSchema.parse(
            await broker.request('discardProposal', parsed, 15_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
