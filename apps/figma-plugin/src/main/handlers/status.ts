import { BRIDGE_PROTOCOL_VERSION, type StatusResult } from '@figma-agent/protocol';

export function getStatus(): StatusResult {
  return {
    connected: true,
    authenticated: true,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    pluginVersion: '0.1.0',
    document: { name: figma.root.name },
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parent?.id,
    })),
    capabilities: [
      'current-page-only',
      'proposal-only-mutations',
      'node-snapshots',
      'layout-plan-v1',
      'render-png',
      'export-assets',
    ],
  };
}
