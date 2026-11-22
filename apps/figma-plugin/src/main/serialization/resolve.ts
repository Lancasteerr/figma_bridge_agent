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
export async function resolveCurrentPageReadNode(nodeId: string): Promise<SceneNode | PageNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new BridgeFault({
      code: 'NODE_NOT_FOUND',
      message: `Node ${nodeId} was not found.`,
      retryable: false,
      nodeId,
    });
  }
  if (node.type !== 'PAGE' && !isSceneNode(node)) {
    throw new BridgeFault({
      code: 'UNSUPPORTED_NODE_TYPE',
      message: `Node ${nodeId} is a ${node.type}; use the current page or a scene node.`,
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
  if (node.type === 'PAGE') {
    await node.loadAsync();
    if (node.id !== figma.currentPage.id) {
      throw new BridgeFault({
        code: 'NODE_NOT_IN_CURRENT_PAGE',
        message: `Page ${nodeId} is no longer the current page. Retry with figma_status.page.id.`,
        retryable: true,
        nodeId,
      });
    }
  }
  return node;
}

/** 写入、指纹和渲染仍仅接受场景节点，不因页面导航支持而扩大作用范围。 */
export async function resolveCurrentPageNode(nodeId: string): Promise<SceneNode> {
  const node = await resolveCurrentPageReadNode(nodeId);
  if (!isSceneNode(node)) {
    throw new BridgeFault({
      code: 'UNSUPPORTED_NODE_TYPE',
      message: `Node ${nodeId} is a PAGE. Read its children with figma_inspect_browse_nodes, then use a scene node ID for this operation.`,
      retryable: false,
      nodeId,
    });
  }
  return node;
}
