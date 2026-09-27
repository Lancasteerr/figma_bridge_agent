#!/usr/bin/env node
import { access } from 'node:fs/promises';

import { BridgeDaemon } from './bridge/daemon.js';
import { DaemonBridgeClient } from './bridge/daemon-client.js';
import { DaemonLog } from './bridge/daemon-log.js';
import { probeBridgePort } from './config/doctor.js';
import { defaultConfigPath, defaultDaemonLogPath } from './config/paths.js';
import { createConfig, loadConfig } from './config/store.js';
import { startServer } from './server.js';

/** 生成本地配置和一次性配对密钥，供用户粘贴到 Figma 插件。 */
async function setup(): Promise<void> {
  const path = defaultConfigPath();
  const config = await createConfig(path);
  console.log(`Created ${path}`);
  console.log('Paste this pairing secret into the Figma plugin:');
  console.log(config.secret);
}

/** 检查配置是否可读，并探测桥接端口是否已被占用。 */
async function doctor(): Promise<void> {
  const path = defaultConfigPath();
  await access(path);
  const config = await loadConfig(path);
  const port = await probeBridgePort(config);
  console.log(
    JSON.stringify(
      { configPath: path, host: config.host, port: config.port, portState: port },
      null,
      2,
    ),
  );
}

/** 启动 stdio MCP 服务和本地 WebSocket 桥接，并统一处理进程退出信号。 */
async function serve(): Promise<void> {
  const server = await startServer(await loadConfig());
  console.error(JSON.stringify({ level: 'info', message: 'Figma MCP stdio server ready' }));
  const close = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdin.once('end', close);
}

/** detached 子进程入口；端口竞争失败时确认已有健康 Daemon 后正常退出。 */
async function bridgeRun(): Promise<void> {
  const config = await loadConfig();
  const log = new DaemonLog(defaultDaemonLogPath());
  await log.initialize();
  const daemon = new BridgeDaemon(config, { log: (entry) => log.write(entry) });
  try {
    await daemon.start();
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'EADDRINUSE') {
      const client = new DaemonBridgeClient(config, { autoStart: false, connectTimeoutMs: 1_000 });
      try {
        await client.waitUntilReady(1_000);
        log.write({ level: 'info', event: 'daemon_race_lost', outcome: 'existing-daemon-ready' });
        await client.close();
        await log.close();
        return;
      } catch {
        await client.close();
      }
    }
    log.write({
      level: 'error',
      event: 'daemon_start_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    await log.close();
    throw error;
  }

  const close = (): void => {
    void daemon.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await daemon.waitUntilStopped();
  await log.close();
}

/** 用户可显式检查、启动或停止 Daemon；普通 serve 会自动启动，无需额外步骤。 */
async function bridge(command: string | undefined): Promise<void> {
  const config = await loadConfig();
  const client = new DaemonBridgeClient(config, {
    autoStart: command === 'start',
    connectTimeoutMs: command === 'status' || command === 'stop' ? 750 : 3_000,
  });
  try {
    if (command === 'start') client.start();
    await client.waitUntilReady();
    const method = command === 'stop' ? '$daemon.stop' : '$daemon.status';
    const status = await client.request(method, undefined, 5_000);
    console.log(JSON.stringify(status, null, 2));
  } finally {
    await client.close();
  }
}

/** CLI 公开 setup、doctor、serve 和 bridge 管理命令；bridge-run 仅供内部拉起。 */
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'setup') await setup();
  else if (command === 'doctor') await doctor();
  else if (command === 'serve') await serve();
  else if (command === 'bridge-run') await bridgeRun();
  else if (command === 'bridge' && ['start', 'status', 'stop'].includes(process.argv[3] ?? '')) {
    await bridge(process.argv[3]);
  }
  else {
    console.error('Usage: figma-agent-mcp <setup|doctor|serve|bridge start|status|stop>');
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
