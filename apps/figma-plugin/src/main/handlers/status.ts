import { BRIDGE_PROTOCOL_VERSION, type StatusResult } from '@figma-agent/protocol';

/** 返回桥接版本、当前页面、选区和插件支持的能力集合。 */
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
      'adaptive-proposal-scope-v2',
      'node-snapshots',
      'design-plan-v1',
      'render-png',
      'export-assets',
      'asset-staging-v1',
      'font-catalog-v1',
    ],
  };
}
