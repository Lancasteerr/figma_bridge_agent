import { MainToUiMessageSchema } from '../shared/messages.js';
import { BridgeSocketClient } from './socket-client.js';

const connection = document.querySelector<HTMLElement>('#connection');
const page = document.querySelector<HTMLElement>('#page');
const selection = document.querySelector<HTMLElement>('#selection');
const secret = document.querySelector<HTMLInputElement>('#secret');
const bridge = new BridgeSocketClient(
  (state) => parent.postMessage({ pluginMessage: { type: 'bridge-state', state } }, '*'),
  (request) => parent.postMessage({ pluginMessage: { type: 'rpc-request', payload: request } }, '*'),
);

window.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = MainToUiMessageSchema.safeParse((event.data as { pluginMessage?: unknown }).pluginMessage);
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.type === 'plugin-state') {
    if (connection) {
      connection.textContent = message.payload.bridge;
      connection.dataset.state = message.payload.bridge;
    }
    if (page) page.textContent = message.payload.page.name;
    if (selection) {
      selection.textContent = message.payload.selection.map((node) => node.name).join(', ') || 'None';
    }
  } else if (message.type === 'client-secret' && secret) {
    secret.value = message.payload.secret;
    bridge.start(message.payload.secret);
  } else if (message.type === 'rpc-response') {
    bridge.send(message.payload);
  }
};

document.querySelector('#save-secret')?.addEventListener('click', () => {
  if (secret?.value) {
    parent.postMessage({ pluginMessage: { type: 'save-secret', secret: secret.value } }, '*');
    bridge.start(secret.value);
  }
});

document.querySelector('#smoke')?.addEventListener('click', () => {
  parent.postMessage({ pluginMessage: { type: 'smoke-duplicate' } }, '*');
});

document.querySelector('#fixtures')?.addEventListener('click', () => {
  parent.postMessage({ pluginMessage: { type: 'generate-fixtures' } }, '*');
});

parent.postMessage({ pluginMessage: { type: 'ready' } }, '*');
