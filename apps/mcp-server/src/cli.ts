#!/usr/bin/env node
import { access } from 'node:fs/promises';

import { BridgeDaemon } from './bridge/daemon.js';
import { DaemonBridgeClient } from './bridge/daemon-client.js';
import { DaemonLog } from './bridge/daemon-log.js';
import { inspectBridge } from './config/doctor.js';
import { defaultConfigPath, defaultDaemonLogPath } from './config/paths.js';
import { ensureConfig, loadConfig } from './config/store.js';
import { startServer } from './server.js';

const CLI_VERSION = '0.2.0';

/** 旧命令保留一个版本作为 pair 的别名，但不再输出任何永久密钥。 */
async function setup(): Promise<void> {
  console.error('The setup command is deprecated; starting secure pairing instead.');
  await pair();
}

/** 检查配置是否可读，并探测桥接端口是否已被占用。 */
async function doctor(): Promise<void> {
  const path = defaultConfigPath();
  await ensureConfig(path);
  await access(path);
  const config = await loadConfig(path);
  const diagnostic = await inspectBridge(config);
  console.log(
    JSON.stringify(
      { configPath: path, host: config.host, port: config.port, ...diagnostic },
      null,
      2,
    ),
  );
  if (diagnostic.daemonState === 'legacy' || diagnostic.daemonState === 'port-occupied') {
    process.exitCode = 1;
  }
}

/** 启动 stdio MCP 服务和本地 WebSocket 桥接，并统一处理进程退出信号。 */
async function serve(): Promise<void> {
  const server = await startServer(await ensureConfig());
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
  const config = await ensureConfig();
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

interface PairStatus {
  state: 'idle' | 'waiting-plugin' | 'awaiting-confirmation' | 'paired' | 'expired' | 'cancelled';
  sas?: string;
  deviceId?: string;
}

/** 开启短时配对窗口，并在终端展示需要与插件核对的六位短码。 */
async function pair(): Promise<void> {
  const config = await ensureConfig();
  const client = new DaemonBridgeClient(config, { autoStart: true, connectTimeoutMs: 5_000 });
  let completed = false;
  let interrupted = false;
  let shownSas = '';
  const interrupt = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    client.start();
    await client.waitUntilReady(5_000);
    await client.request('$daemon.pair.start', undefined, 5_000);
    console.log('Pairing is open for 120 seconds. Open Local Figma Agent Bridge in Figma Desktop.');
    while (!interrupted) {
      const status = (await client.request('$daemon.pair.status', undefined, 5_000)) as PairStatus;
      if (status.state === 'awaiting-confirmation' && status.sas && status.sas !== shownSas) {
        shownSas = status.sas;
        console.log(`Verification code: ${status.sas}`);
        console.log('Confirm only if the Figma plugin shows the same code.');
      } else if (status.state === 'paired') {
        completed = true;
        console.log(`Paired successfully (${status.deviceId ?? 'device saved'}).`);
        return;
      } else if (status.state === 'expired' || status.state === 'cancelled') {
        throw new Error(`Pairing ${status.state}. Run the pair command again.`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (!completed) {
      await client.request('$daemon.pair.cancel', undefined, 2_000).catch(() => undefined);
    }
    await client.close();
  }
}

/** 设备管理通过已认证的本机 Daemon 执行，输出中不包含 token。 */
async function devices(command: string | undefined, argument: string | undefined): Promise<void> {
  const config = await ensureConfig();
  const client = new DaemonBridgeClient(config, { autoStart: true, connectTimeoutMs: 5_000 });
  try {
    client.start();
    await client.waitUntilReady(5_000);
    if (command === 'list') {
      console.log(JSON.stringify(await client.request('$daemon.devices.list'), null, 2));
      return;
    }
    if (command === 'revoke' && argument) {
      const params = argument === '--all' ? { all: true } : { deviceId: argument };
      await client.request('$daemon.devices.revoke', params);
      console.log(
        argument === '--all' ? 'All paired devices were revoked.' : `Revoked ${argument}.`,
      );
      return;
    }
    throw new Error('Usage: figma-local-agent-mcp devices <list|revoke <deviceId>|revoke --all>');
  } finally {
    await client.close();
  }
}

/** CLI 公开 setup、doctor、serve 和 bridge 管理命令；bridge-run 仅供内部拉起。 */
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === '--version' || command === '-v') console.log(CLI_VERSION);
  else if (command === 'setup') await setup();
  else if (command === 'pair') await pair();
  else if (command === 'devices') await devices(process.argv[3], process.argv[4]);
  else if (command === 'doctor') await doctor();
  else if (command === 'serve') await serve();
  else if (command === 'bridge-run') await bridgeRun();
  else if (command === 'bridge' && ['start', 'status', 'stop'].includes(process.argv[3] ?? '')) {
    await bridge(process.argv[3]);
  } else {
    console.error(
      'Usage: figma-local-agent-mcp <serve|pair|doctor|devices list|devices revoke <id>|devices revoke --all>',
    );
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
