import { connect } from 'node:net';

import { DaemonStatusResultSchema, type DaemonStatusResult } from '@figma-agent/protocol';

import { DaemonBridgeClient } from '../bridge/daemon-client.js';
import type { ServerConfig } from './store.js';

export type BridgeDiagnostic =
  | { daemonState: 'running'; status: DaemonStatusResult }
  | { daemonState: 'stopped' }
  | { daemonState: 'legacy'; message: string }
  | { daemonState: 'port-occupied'; message: string };

/** 先探测 TCP，再执行 Daemon 协议认证，避免把任意监听者误报为健康桥接。 */
export async function inspectBridge(config: ServerConfig): Promise<BridgeDiagnostic> {
  if (!(await isPortListening(config))) return { daemonState: 'stopped' };
  const client = new DaemonBridgeClient(config, {
    autoStart: false,
    connectTimeoutMs: 500,
    spawnDaemon: () => undefined,
  });
  try {
    await client.waitUntilReady(500);
    const status = DaemonStatusResultSchema.parse(
      await client.request('$daemon.status', undefined, 1_000),
    );
    return { daemonState: 'running', status };
  } catch {
    if (client.lastFailure === 'legacy') {
      return {
        daemonState: 'legacy',
        message: 'A pre-daemon bridge server owns the port. Close old MCP tasks once, then retry.',
      };
    }
    return {
      daemonState: 'port-occupied',
      message: `Port ${config.port} is listening but did not complete the daemon protocol (${client.lastFailure}).`,
    };
  } finally {
    await client.close();
  }
}

async function isPortListening(config: ServerConfig): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({ host: config.host, port: config.port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
