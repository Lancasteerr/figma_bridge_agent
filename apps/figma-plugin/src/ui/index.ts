import { MainToUiMessageSchema } from '../shared/messages.js';

const connection = document.querySelector<HTMLElement>('#connection');
const page = document.querySelector<HTMLElement>('#page');
const selection = document.querySelector<HTMLElement>('#selection');
const secret = document.querySelector<HTMLInputElement>('#secret');

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
  }
};

document.querySelector('#save-secret')?.addEventListener('click', () => {
  if (secret?.value) parent.postMessage({ pluginMessage: { type: 'save-secret', secret: secret.value } }, '*');
});

document.querySelector('#smoke')?.addEventListener('click', () => {
  parent.postMessage({ pluginMessage: { type: 'smoke-duplicate' } }, '*');
});

parent.postMessage({ pluginMessage: { type: 'ready' } }, '*');

