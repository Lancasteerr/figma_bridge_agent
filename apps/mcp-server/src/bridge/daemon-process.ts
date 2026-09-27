import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 隐藏窗口启动独立 Daemon；多个调用者并发执行时由端口绑定决定唯一存活实例。 */
export function spawnBridgeDaemon(): void {
  const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url));
  const child = spawn(process.execPath, [cliPath, 'bridge-run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}
