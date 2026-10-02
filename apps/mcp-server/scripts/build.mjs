import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const outfile = resolve(root, 'dist/cli.js');
// 所有运行时第三方包都由 npm 安装并由 Node 解析；内部 workspace 包仍打入单文件 CLI。
// 同时声明包根和子路径，避免依赖新增子路径导入后被 esbuild 意外内联。
const external = Object.keys(packageJson.dependencies ?? {}).flatMap((name) => [name, `${name}/*`]);
await mkdir(resolve(root, 'dist'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  external,
  define: { __CLI_VERSION__: JSON.stringify(packageJson.version) },
});
await chmod(outfile, 0o755).catch(() => undefined);

// 必须执行产物而不只检查 esbuild 成功；这能捕获 ESM bundle 中的动态 require 等启动错误。
const smoke = spawnSync(process.execPath, [outfile, '--version'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
});
if (smoke.status !== 0 || smoke.stdout.trim() !== packageJson.version) {
  throw new Error(
    `Built CLI smoke test failed: ${smoke.stderr.trim() || smoke.stdout.trim() || `exit ${String(smoke.status)}`}`,
  );
}
