import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import JSZip from 'jszip';

import {
  AGENT_PLUGIN_ARCHIVE_ROOT,
  AGENT_PLUGIN_FILES,
  getAgentPluginArchiveName,
} from './check-agent-plugin.mjs';

const workspace = resolve(import.meta.dirname, '..');
const defaultPluginRoot = resolve(workspace, 'plugins/figma-local-agent');

function formatPaths(paths) {
  return paths.map((path) => `  - ${path}`).join('\n');
}

/**
 * 校验归档文件集合及内容均与可移植插件源目录一致。
 * pluginRoot 参数用于测试隔离；正常调用始终使用仓库内插件目录。
 */
export async function checkAgentPluginArchive(
  archivePath,
  { pluginRoot = defaultPluginRoot } = {},
) {
  const archive = await JSZip.loadAsync(await readFile(archivePath));
  const expectedPaths = AGENT_PLUGIN_FILES.map(
    (file) => `${AGENT_PLUGIN_ARCHIVE_ROOT}/${file}`,
  ).sort();
  const fileEntries = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({ entry, path: entry.name.replaceAll('\\', '/') }));
  const actualPaths = fileEntries.map(({ path }) => path).sort();
  const archiveEntryByPath = new Map(fileEntries.map(({ entry, path }) => [path, entry]));
  const actualPathSet = new Set(actualPaths);
  const expectedPathSet = new Set(expectedPaths);
  const missing = expectedPaths.filter((path) => !actualPathSet.has(path));
  const unexpected = actualPaths.filter((path) => !expectedPathSet.has(path));
  const problems = [];

  if (missing.length > 0) problems.push(`Missing files:\n${formatPaths(missing)}`);
  if (unexpected.length > 0) problems.push(`Unexpected files:\n${formatPaths(unexpected)}`);

  const mismatched = [];
  for (const file of AGENT_PLUGIN_FILES) {
    const archivedPath = `${AGENT_PLUGIN_ARCHIVE_ROOT}/${file}`;
    const entry = archiveEntryByPath.get(archivedPath);
    if (!entry) continue;
    const [expectedContent, actualContent] = await Promise.all([
      readFile(resolve(pluginRoot, file)),
      entry.async('nodebuffer'),
    ]);
    if (!expectedContent.equals(actualContent)) mismatched.push(archivedPath);
  }
  if (mismatched.length > 0) {
    problems.push(`Content mismatches:\n${formatPaths(mismatched)}`);
  }

  if (problems.length > 0) {
    throw new Error(`Agent Plugin archive validation failed:\n${problems.join('\n')}`);
  }

  return { archivePath, files: actualPaths };
}

async function getDefaultArchivePath() {
  const serverPackage = JSON.parse(
    await readFile(resolve(workspace, 'apps/mcp-server/package.json'), 'utf8'),
  );
  return resolve(workspace, 'artifacts', getAgentPluginArchiveName(serverPackage.version));
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) {
    throw new Error('Usage: node scripts/check-agent-plugin-archive.mjs [archive-path]');
  }
  const archivePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : await getDefaultArchivePath();
  const result = await checkAgentPluginArchive(archivePath);
  console.log(`Validated Agent Plugin archive with ${result.files.length} files: ${archivePath}`);
}
