import { BridgeFault } from '@figma-agent/protocol';

export function isSceneNode(node: BaseNode): node is SceneNode {
  return node.type !== 'DOCUMENT' && node.type !== 'PAGE' && 'x' in node && 'width' in node;
}

export function findPage(node: BaseNode): PageNode | undefined {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current?.type === 'PAGE' ? current : undefined;
}

export async function resolveCurrentPageNode(nodeId: string): Promise<SceneNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || !isSceneNode(node)) {
    throw new BridgeFault({
      code: 'NODE_NOT_FOUND',
      message: `Scene node ${nodeId} was not found.`,
      retryable: false,
      nodeId,
    });
  }
  if (findPage(node)?.id !== figma.currentPage.id) {
    throw new BridgeFault({
      code: 'NODE_NOT_IN_CURRENT_PAGE',
      message: `Node ${nodeId} is not on the current page.`,
      retryable: true,
      nodeId,
    });
  }
  return node;
}
