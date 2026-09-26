import { UiToMainMessageSchema } from '../shared/messages.js';
import { publishPluginState, setBridgeState } from './state.js';

figma.showUI(__html__, { width: 340, height: 280, themeColors: true });

figma.ui.onmessage = async (raw: unknown) => {
  const parsed = UiToMainMessageSchema.safeParse(raw);
  if (!parsed.success) {
    figma.notify('Local Figma Agent Bridge received an invalid UI message', { error: true });
    return;
  }

  const message = parsed.data;
  if (message.type === 'ready') {
    publishPluginState();
    const secret = await figma.clientStorage.getAsync('bridge-secret');
    if (typeof secret === 'string') {
      figma.ui.postMessage({ type: 'client-secret', payload: { secret } });
    }
  } else if (message.type === 'bridge-state') {
    setBridgeState(message.state);
    publishPluginState();
  } else if (message.type === 'save-secret') {
    await figma.clientStorage.setAsync('bridge-secret', message.secret);
    figma.ui.postMessage({ type: 'client-secret', payload: { secret: message.secret } });
  } else if (message.type === 'smoke-duplicate') {
    const selected = figma.currentPage.selection[0];
    if (!selected) {
      figma.notify('Select one node first', { error: true });
      return;
    }
    const clone = selected.clone();
    clone.name = `${selected.name} / Smoke Proposal`;
    clone.x = selected.x + selected.width + 64;
    figma.currentPage.selection = [clone];
    figma.viewport.scrollAndZoomIntoView([clone]);
    figma.commitUndo();
    publishPluginState();
  }
};

figma.on('selectionchange', publishPluginState);
figma.on('currentpagechange', publishPluginState);

