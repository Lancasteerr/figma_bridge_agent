import { BRIDGE_PROTOCOL_VERSION, type RpcEvent } from '@figma-agent/protocol';

let sequence = 0;
let observedPage: PageNode | undefined;
let publish: ((event: RpcEvent) => void) | undefined;

const nodeChanged = (event: NodeChangeEvent): void => {
  emit('nodeChanged', {
    changes: event.nodeChanges.map((change) => ({ type: change.type, id: change.node.id })),
  });
};

function emit(event: RpcEvent['event'], payload: unknown): void {
  sequence += 1;
  publish?.({ version: BRIDGE_PROTOCOL_VERSION, event, sequence, payload });
}

function observeCurrentPage(): void {
  if (observedPage) observedPage.off('nodechange', nodeChanged);
  observedPage = figma.currentPage;
  observedPage.on('nodechange', nodeChanged);
}

export function startEvents(listener: (event: RpcEvent) => void): void {
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

