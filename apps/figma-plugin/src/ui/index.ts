import { MainToUiMessageSchema, type PluginAuth } from '../shared/messages.js';
import { PairingClient, type PairingViewState } from './pairing-client.js';
import { BridgeSocketClient, type ConnectionState } from './socket-client.js';

const PAIR_COMMAND = `npx -y figma-local-agent-mcp@${__PLUGIN_VERSION__} pair`;
const connection = document.querySelector<HTMLElement>('#connection');
const page = document.querySelector<HTMLElement>('#page');
const selection = document.querySelector<HTMLElement>('#selection');
const unpairedPanel = document.querySelector<HTMLElement>('#unpaired-panel');
const pairedPanel = document.querySelector<HTMLElement>('#paired-panel');
const pairingStatus = document.querySelector<HTMLElement>('#pairing-status');
const pairingCode = document.querySelector<HTMLElement>('#pairing-code');
const confirmButton = document.querySelector<HTMLButtonElement>('#confirm-pairing');
const cancelButton = document.querySelector<HTMLButtonElement>('#cancel-pairing');
const deviceId = document.querySelector<HTMLElement>('#device-id');
const migrationNotice = document.querySelector<HTMLElement>('#migration-notice');
const command = document.querySelector<HTMLElement>('#pair-command');

let currentAuth: PluginAuth | null = null;

const bridge = new BridgeSocketClient(
  renderConnection,
  (request) =>
    parent.postMessage({ pluginMessage: { type: 'rpc-request', payload: request } }, '*'),
  (reason) => {
    renderPairing({ state: 'error', message: reason });
    parent.postMessage({ pluginMessage: { type: 'clear-auth' } }, '*');
  },
);

const pairing = new PairingClient(renderPairing, (auth) => {
  parent.postMessage({ pluginMessage: { type: 'save-auth', auth } }, '*');
});

function renderConnection(state: ConnectionState): void {
  if (!connection) return;
  connection.textContent =
    state === 'authenticated'
      ? 'Connected'
      : state === 'connecting'
        ? 'Connecting…'
        : 'Disconnected';
  connection.dataset.state = state;
  parent.postMessage({ pluginMessage: { type: 'bridge-state', state } }, '*');
}

function renderPairing(view: PairingViewState): void {
  if (pairingCode) {
    pairingCode.hidden = view.state !== 'code';
    pairingCode.textContent = view.state === 'code' ? view.sas : '------';
  }
  if (confirmButton) confirmButton.hidden = view.state !== 'code';
  if (cancelButton) cancelButton.hidden = view.state !== 'code';
  if (!pairingStatus) return;
  pairingStatus.textContent =
    view.state === 'waiting'
      ? 'Waiting for a 120-second pairing session…'
      : view.state === 'code'
        ? 'Compare this code with the terminal, then confirm.'
        : view.message;
  pairingStatus.dataset.state = view.state;
}

function applyAuth(auth: PluginAuth | null): void {
  currentAuth = auth;
  if (unpairedPanel) unpairedPanel.hidden = auth !== null;
  if (pairedPanel) pairedPanel.hidden = auth === null;
  if (deviceId) deviceId.textContent = auth?.deviceId ?? '—';
  if (auth) {
    pairing.stop();
    bridge.start(auth);
  } else {
    bridge.stop();
    pairing.start();
  }
}

window.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = MainToUiMessageSchema.safeParse(
    (event.data as { pluginMessage?: unknown }).pluginMessage,
  );
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.type === 'plugin-state') {
    if (page) page.textContent = message.payload.page.name;
    if (selection) {
      selection.textContent =
        message.payload.selection.map((node) => node.name).join(', ') || 'None';
    }
  } else if (message.type === 'client-auth') {
    if (migrationNotice) migrationNotice.hidden = !message.payload.migrated;
    applyAuth(message.payload.auth);
  } else if (message.type === 'rpc-response') {
    bridge.send(message.payload);
  }
};

if (command) command.textContent = PAIR_COMMAND;
document.querySelector('#copy-command')?.addEventListener('click', () => {
  void navigator.clipboard?.writeText(PAIR_COMMAND);
});
confirmButton?.addEventListener('click', () => pairing.confirm());
cancelButton?.addEventListener('click', () => pairing.cancel());
document.querySelector('#retry-pairing')?.addEventListener('click', () => pairing.start());
document.querySelector('#clear-auth')?.addEventListener('click', () => {
  if (currentAuth) parent.postMessage({ pluginMessage: { type: 'clear-auth' } }, '*');
});

parent.postMessage({ pluginMessage: { type: 'ready' } }, '*');
