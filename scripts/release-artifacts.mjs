import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import JSZip from 'jszip';

import {
  AGENT_PLUGIN_ARCHIVE_ROOT,
  AGENT_PLUGIN_FILES,
  checkAgentPlugin,
  getAgentPluginArchiveName,
} from './check-agent-plugin.mjs';

const workspace = resolve(import.meta.dirname, '..');
const artifacts = resolve(workspace, 'artifacts');
if (dirname(artifacts) !== workspace || basename(artifacts) !== 'artifacts') {
  throw new Error('Refusing to clean an unexpected artifact directory.');
}
const pluginRoot = resolve(workspace, 'apps/figma-plugin');
const serverRoot = resolve(workspace, 'apps/mcp-server');
const agentPluginRoot = resolve(workspace, 'plugins/figma-local-agent');
const pluginPackage = JSON.parse(await readFile(resolve(pluginRoot, 'package.json'), 'utf8'));
const serverPackage = JSON.parse(await readFile(resolve(serverRoot, 'package.json'), 'utf8'));

if (pluginPackage.version !== serverPackage.version) {
  throw new Error('Plugin and npm package versions must match.');
}
const version = serverPackage.version;
const checkedAgentPlugin = await checkAgentPlugin();
if (checkedAgentPlugin.version !== version) {
  throw new Error('Agent Plugin and npm package versions must match.');
}
const manifest = JSON.parse(await readFile(resolve(pluginRoot, 'dist/manifest.json'), 'utf8'));
if (manifest.id !== '1685966253180273328') throw new Error('Release plugin ID is invalid.');
if (
  JSON.stringify(manifest.networkAccess) !==
  JSON.stringify({ allowedDomains: ['none'], devAllowedDomains: ['ws://localhost:3900'] })
) {
  throw new Error('Release plugin network permissions are invalid.');
}

await mkdir(artifacts, { recursive: true });

const zip = new JSZip();
for (const file of ['manifest.json', 'code.js', 'ui.html']) {
  zip.file(`figma-agent-bridge-plugin/${file}`, await readFile(resolve(pluginRoot, 'dist', file)));
}
const pluginArchive = `figma-agent-bridge-plugin-v${version}.zip`;
const packageArchive = `figma-local-agent-mcp-${version}.tgz`;
const agentPluginArchive = getAgentPluginArchiveName(version);
for (const generatedFile of [pluginArchive, packageArchive, agentPluginArchive, 'SHA256SUMS']) {
  // 只清理本次发行会覆盖的文件，保留用户可能解压在 artifacts 下的插件目录。
  await unlink(resolve(artifacts, generatedFile)).catch(() => undefined);
}
await writeFile(
  resolve(artifacts, pluginArchive),
  await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  }),
);

const agentPluginZip = new JSZip();
for (const file of AGENT_PLUGIN_FILES) {
  agentPluginZip.file(
    `${AGENT_PLUGIN_ARCHIVE_ROOT}/${file}`,
    await readFile(resolve(agentPluginRoot, file)),
  );
}
await writeFile(
  resolve(artifacts, agentPluginArchive),
  await agentPluginZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  }),
);

const npmArgs = ['pack', serverRoot, '--pack-destination', artifacts, '--ignore-scripts'];
const packed =
  process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm', ...npmArgs], {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })
    : spawnSync('npm', npmArgs, {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      });
if (packed.status !== 0) {
  throw new Error(`npm pack failed: ${packed.error?.message ?? `exit ${String(packed.status)}`}`);
}
const packedArchive = packed.stdout.trim().split(/\r?\n/).at(-1);
if (packedArchive !== packageArchive) {
  throw new Error(`Unexpected npm archive name: ${packedArchive ?? 'none'}`);
}

const checksumLines = [];
for (const file of [pluginArchive, packageArchive, agentPluginArchive]) {
  const digest = createHash('sha256')
    .update(await readFile(resolve(artifacts, file)))
    .digest('hex');
  checksumLines.push(`${digest}  ${file}`);
}
await writeFile(resolve(artifacts, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);
console.log(`Created release artifacts for v${version} in ${artifacts}`);
