import { PluginAuthSchema, UiToMainMessageSchema } from '../shared/messages.js';
import { assetCache } from './assets/asset-cache.js';
import { startEvents } from './events.js';
import { stageAsset } from './handlers/assets.js';
import { getNode, getSelection, getTree } from './handlers/read.js';
import { getStatus } from './handlers/status.js';
import { exportAsset, renderNode } from './handlers/render.js';
import { discardProposal, duplicateAsProposal } from './handlers/proposal.js';
import { createFrame, reparentNodes } from './handlers/structural.js';
import { setLayout } from './handlers/layout.js';
import { updateText } from './handlers/text.js';
import { setInstanceProperties } from './handlers/instance.js';
import { createComponentFromNode } from './handlers/component.js';
import { getCss, getRawNode, getVariables } from './handlers/codegen.js';
import { applyDesignPlan, validateDesignPlan } from './handlers/design-plan.js';
import { RpcRouter } from './rpc/router.js';
import { publishPluginState, setBridgeState } from './state.js';

// Main 线程只负责组装路由和边界事件；具体读写逻辑保持在独立 handler 中。
figma.showUI(__html__, { width: 360, height: 360, themeColors: true });

const router = new RpcRouter();
router.register('status', getStatus);
router.register('getSelection', getSelection);
router.register('getNode', getNode);
router.register('getTree', getTree);
router.register('renderNode', renderNode);
router.register('exportAsset', exportAsset);
router.register('duplicateAsProposal', duplicateAsProposal);
router.register('discardProposal', discardProposal);
router.register('createFrame', createFrame);
router.register('reparentNodes', reparentNodes);
router.register('setLayout', setLayout);
router.register('updateText', updateText);
router.register('setInstanceProperties', setInstanceProperties);
router.register('createComponentFromNode', createComponentFromNode);
router.register('getCss', getCss);
router.register('getVariables', getVariables);
router.register('getRawNode', getRawNode);
router.register('validateDesignPlan', validateDesignPlan);
router.register('applyDesignPlan', applyDesignPlan);
router.register('stageAsset', stageAsset);
startEvents((event) => figma.ui.postMessage({ type: 'rpc-response', payload: event }));

// UI 消息先过 shared schema，再根据 type 分发，避免不可信 payload 直接触碰 Figma API。
figma.ui.onmessage = async (raw: unknown) => {
  const parsed = UiToMainMessageSchema.safeParse(raw);
  if (!parsed.success) {
    figma.notify('Local Figma Agent Bridge received an invalid UI message', { error: true });
    return;
  }

  const message = parsed.data;
  if (message.type === 'ready') {
    publishPluginState();
    const legacySecret = await figma.clientStorage.getAsync('bridge-secret');
    const migrated = typeof legacySecret === 'string';
    if (migrated) await figma.clientStorage.deleteAsync('bridge-secret');
    const stored = PluginAuthSchema.safeParse(await figma.clientStorage.getAsync('bridge-auth-v2'));
    figma.ui.postMessage({
      type: 'client-auth',
      payload: { auth: stored.success ? stored.data : null, migrated },
    });
  } else if (message.type === 'bridge-state') {
    setBridgeState(message.state);
    if (message.state === 'disconnected') assetCache.clear();
    publishPluginState();
  } else if (message.type === 'save-auth') {
    await figma.clientStorage.setAsync('bridge-auth-v2', message.auth);
    figma.ui.postMessage({ type: 'client-auth', payload: { auth: message.auth, migrated: false } });
  } else if (message.type === 'clear-auth') {
    await figma.clientStorage.deleteAsync('bridge-auth-v2');
    figma.ui.postMessage({ type: 'client-auth', payload: { auth: null, migrated: false } });
  } else if (message.type === 'rpc-request') {
    const response = await router.route(message.payload);
    figma.ui.postMessage({ type: 'rpc-response', payload: response });
  }
};

figma.on('selectionchange', publishPluginState);
figma.on('currentpagechange', publishPluginState);
