import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, context } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(root, '../..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

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
};

const uiOptions = {
  entryPoints: [resolve(root, 'src/ui/index.ts')],
  outfile: resolve(dist, 'ui.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  sourcemap: true,
};

async function buildUiHtml() {
  const template = await readFile(resolve(root, 'src/ui/index.html'), 'utf8');
  const script = await readFile(resolve(dist, 'ui.js'), 'utf8');
  await writeFile(
    resolve(dist, 'ui.html'),
    template.replace('<!-- SCRIPT -->', `<script>${script}</script>`),
  );
}

if (watch) {
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
