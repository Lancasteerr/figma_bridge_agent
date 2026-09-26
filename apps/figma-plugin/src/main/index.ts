import { UiToMainMessageSchema } from '../shared/messages.js';
import { startEvents } from './events.js';
import { getNode, getSelection, getTree } from './handlers/read.js';
import { getStatus } from './handlers/status.js';
import { renderNode } from './handlers/render.js';
import { discardProposal, duplicateAsProposal } from './handlers/proposal.js';
import { createFrame, reparentNodes } from './handlers/structural.js';
import { setLayout } from './handlers/layout.js';
import { updateText } from './handlers/text.js';
import { applyLayoutPlan, validateLayoutPlan } from './handlers/layout-plan.js';
import { RpcRouter } from './rpc/router.js';
import { publishPluginState, setBridgeState } from './state.js';

figma.showUI(__html__, { width: 340, height: 280, themeColors: true });

const router = new RpcRouter();
router.register('status', getStatus);
router.register('getSelection', getSelection);
router.register('getNode', getNode);
router.register('getTree', getTree);
router.register('renderNode', renderNode);
router.register('duplicateAsProposal', duplicateAsProposal);
router.register('discardProposal', discardProposal);
router.register('createFrame', createFrame);
router.register('reparentNodes', reparentNodes);
router.register('setLayout', setLayout);
router.register('updateText', updateText);
router.register('validateLayoutPlan', validateLayoutPlan);
router.register('applyLayoutPlan', applyLayoutPlan);
startEvents((event) => figma.ui.postMessage({ type: 'rpc-response', payload: event }));

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
  } else if (message.type === 'rpc-request') {
    const response = await router.route(message.payload);
    figma.ui.postMessage({ type: 'rpc-response', payload: response });
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
