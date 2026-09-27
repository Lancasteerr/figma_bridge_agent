import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, context } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(root, '../..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

// dist 是可重复生成目录；manifest 使用本地 ID（若缺失则使用不可安装的占位 ID）。
await mkdir(dist, { recursive: true });

const baseManifest = JSON.parse(await readFile(resolve(root, 'manifest.base.json'), 'utf8'));
const idPath = resolve(workspaceRoot, '.figma-plugin-id');
const id = existsSync(idPath) ? (await readFile(idPath, 'utf8')).trim() : '000000000000000000';
await writeFile(
  resolve(dist, 'manifest.json'),
  `${JSON.stringify({ ...baseManifest, id }, null, 2)}\n`,
);

const mainOptions = {
  entryPoints: [resolve(root, 'src/main/index.ts')],
  outfile: resolve(dist, 'code.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  sourcemap: true,
  // Figma 运行时会误将依赖注释中的 import() 识别为动态导入；压缩空白会移除这类注释。
  minifyWhitespace: true,
};

const uiOptions = {
  entryPoints: [resolve(root, 'src/ui/index.ts')],
  outfile: resolve(dist, 'ui.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  sourcemap: true,
  // UI bundle 也需要移除可能触发 Figma 动态导入检查的注释。
  minifyWhitespace: true,
};

/** 将 HTML 模板中的占位符替换为已打包的 UI 脚本。 */
async function buildUiHtml() {
  const template = await readFile(resolve(root, 'src/ui/index.html'), 'utf8');
  const script = await readFile(resolve(dist, 'ui.js'), 'utf8');
  await writeFile(
    resolve(dist, 'ui.html'),
    template.replace('<!-- SCRIPT -->', `<script>${script}</script>`),
  );
}

if (watch) {
  // watch 模式让 UI bundle 的 onEnd 钩子同步刷新 ui.html。
  const mainContext = await context(mainOptions);
  const uiContext = await context({
    ...uiOptions,
    plugins: [
      {
        name: 'html',
        setup(buildApi) {
          buildApi.onEnd(buildUiHtml);
        },
      },
    ],
  });
  await Promise.all([mainContext.watch(), uiContext.watch()]);
  console.error('Watching Figma plugin sources...');
} else {
  await build(mainOptions);
  await build(uiOptions);
  await buildUiHtml();
}
