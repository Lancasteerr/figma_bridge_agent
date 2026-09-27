import type { MainToUiMessage } from '../shared/messages.js';

let bridgeState: 'disconnected' | 'connecting' | 'authenticated' = 'disconnected';

/** 保存 UI 展示的桥接状态；状态来源是 UI socket client 的显式通知。 */
export function setBridgeState(state: typeof bridgeState): void {
  bridgeState = state;
}

/** 读取当前桥接状态，供 UI 或诊断逻辑复用。 */
export function getBridgeState(): typeof bridgeState {
  return bridgeState;
}

/** 发布当前页面和选区摘要，避免 UI 直接访问 Figma Main API。 */
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
