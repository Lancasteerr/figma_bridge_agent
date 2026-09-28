import { chmod, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await mkdir(resolve(root, 'dist'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/cli.ts')],
  outfile: resolve(root, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  // 内部 workspace 协议会被打进 CLI；第三方依赖交给 npm 正常安装，避免 CJS 动态 require 被破坏。
  external: ['@modelcontextprotocol/server', '@noble/curves/*', '@noble/hashes/*', 'ws', 'zod'],
  define: { __CLI_VERSION__: JSON.stringify(packageJson.version) },
});
await chmod(resolve(root, 'dist/cli.js'), 0o755).catch(() => undefined);
