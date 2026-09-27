import { BridgeFault } from '@figma-agent/protocol';

/** Figma BaseNode 中排除 DOCUMENT/PAGE 后的可操作场景节点类型守卫。 */
export function isSceneNode(node: BaseNode): node is SceneNode {
  return node.type !== 'DOCUMENT' && node.type !== 'PAGE' && 'x' in node && 'width' in node;
}

/** 沿 parent 链寻找所属 Page，用于阻止跨页面读写。 */
export function findPage(node: BaseNode): PageNode | undefined {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current?.type === 'PAGE' ? current : undefined;
}

/** 异步解析当前页面节点，并将“不存在”和“非当前页”区分成不同错误。 */
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
