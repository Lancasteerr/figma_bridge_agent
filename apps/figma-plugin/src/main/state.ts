import type { MainToUiMessage } from '../shared/messages.js';

let bridgeState: 'disconnected' | 'connecting' | 'authenticated' = 'disconnected';

export function setBridgeState(state: typeof bridgeState): void {
  bridgeState = state;
}

export function publishPluginState(): void {
  const message: MainToUiMessage = {
    type: 'plugin-state',
    payload: {
      page: { id: figma.currentPage.id, name: figma.currentPage.name },
      selection: figma.currentPage.selection.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
      })),
      bridge: bridgeState,
    },
  };
  figma.ui.postMessage(message);
}

