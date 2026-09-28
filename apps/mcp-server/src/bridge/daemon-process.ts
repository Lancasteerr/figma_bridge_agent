import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

/** 隐藏窗口启动独立 Daemon；多个调用者并发执行时由端口绑定决定唯一存活实例。 */
export function spawnBridgeDaemon(): void {
  // 打包后所有模块位于同一个 CLI 文件，process.argv[1] 是最稳定的自启动入口。
  const cliPath = resolve(process.argv[1] ?? '');
  const child = spawn(process.execPath, [cliPath, 'bridge-run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}
