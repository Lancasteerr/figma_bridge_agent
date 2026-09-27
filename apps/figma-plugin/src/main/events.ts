import { BRIDGE_PROTOCOL_VERSION, type RpcEvent } from '@figma-agent/protocol';

let sequence = 0;
let observedPage: PageNode | undefined;
let publish: ((event: RpcEvent) => void) | undefined;

/** 将 Figma nodechange 压缩为节点 ID 和变更类型，避免事件 payload 过大。 */
const nodeChanged = (event: NodeChangeEvent): void => {
  emit('nodeChanged', {
    changes: event.nodeChanges.map((change) => ({ type: change.type, id: change.node.id })),
  });
};

function emit(event: RpcEvent['event'], payload: unknown): void {
  // sequence 在插件生命周期内单调递增，帮助消费方识别事件顺序。
  sequence += 1;
  publish?.({ version: BRIDGE_PROTOCOL_VERSION, event, sequence, payload });
}

function observeCurrentPage(): void {
  // currentPagechange 后必须先解绑旧 Page，否则切页后会重复发送 nodeChanged。
  if (observedPage) observedPage.off('nodechange', nodeChanged);
  observedPage = figma.currentPage;
  observedPage.on('nodechange', nodeChanged);
}

export function startEvents(listener: (event: RpcEvent) => void): void {
  /** 启动选区、页面和当前页面节点变化的桥接事件监听。 */
  publish = listener;
  observeCurrentPage();
  figma.on('selectionchange', () => {
    emit('selectionChanged', { nodeIds: figma.currentPage.selection.map((node) => node.id) });
  });
  figma.on('currentpagechange', () => {
    observeCurrentPage();
    emit('currentPageChanged', { pageId: figma.currentPage.id, name: figma.currentPage.name });
  });
}
