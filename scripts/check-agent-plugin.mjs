import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const AGENT_PLUGIN_FILES = [
  'plugin.json',
  'mcp.json',
  'skills/figma-local-agent/SKILL.md',
  'skills/figma-local-agent/references/design-plan-v1.md',
];
export const AGENT_PLUGIN_ARCHIVE_ROOT = 'figma-local-agent';

/** 统一生成 Agent Plugin 归档名称，避免构建与校验流程各自拼接。 */
export function getAgentPluginArchiveName(version) {
  return `figma-local-agent-plugin-v${version}.zip`;
}

const workspace = resolve(import.meta.dirname, '..');
const pluginRoot = resolve(workspace, 'plugins/figma-local-agent');
const marketplacePath = resolve(workspace, '.agents/plugins/marketplace.json');
const packagePaths = [
  'package.json',
  'apps/figma-plugin/package.json',
  'apps/mcp-server/package.json',
  'packages/protocol/package.json',
  'packages/test-support/package.json',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** 校验可移植 Agent Plugin 与单一发行版本，避免宿主适配或版本漂移进入发布产物。 */
export async function checkAgentPlugin() {
  const packages = await Promise.all(
    packagePaths.map(async (path) => [path, await readJson(resolve(workspace, path))]),
  );
  const serverPackage = packages.find(([path]) => path === 'apps/mcp-server/package.json')?.[1];
  assert(serverPackage, 'MCP server package metadata is missing.');
  const version = serverPackage.version;
  assert(/^\d+\.\d+\.\d+$/.test(version), 'Release version must use strict semantic versioning.');
  for (const [path, metadata] of packages) {
    assert(metadata.version === version, `${path} version must equal ${version}.`);
  }

  const plugin = await readJson(resolve(pluginRoot, 'plugin.json'));
  assert(
    plugin.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    'Agent Plugin manifest must use the Agent Plugins 1.0 schema.',
  );
  assert(plugin.name === 'figma-local-agent', 'Agent Plugin name is invalid.');
  assert(plugin.version === version, `Agent Plugin version must equal ${version}.`);
  assert(
    typeof plugin.description === 'string' && plugin.description.length > 0,
    'Description is required.',
  );
  assert(
    typeof plugin.author?.name === 'string' && plugin.author.name.length > 0,
    'Author is required.',
  );
  assert(plugin.license === 'MIT', 'Agent Plugin license must be MIT.');
  for (const forbidden of ['extensions', 'hooks', 'mcpServers', 'apps']) {
    assert(!(forbidden in plugin), `Portable Agent Plugin must not declare ${forbidden}.`);
  }

  const mcp = await readJson(resolve(pluginRoot, 'mcp.json'));
  assert(
    mcp.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    'Agent Plugin MCP config must use the Agent Plugins 1.0 schema.',
  );
  assert(
    Object.keys(mcp.mcpServers ?? {}).length === 1 && mcp.mcpServers['figma-local-agent'],
    'Agent Plugin must declare exactly one figma-local-agent MCP server.',
  );
  const server = mcp.mcpServers['figma-local-agent'];
  assert(server.type === 'stdio', 'Agent Plugin MCP server must use stdio.');
  assert(server.command === 'npx.cmd', 'Windows GUI clients must launch npx.cmd.');
  assert(
    JSON.stringify(server.args) ===
      JSON.stringify(['-y', `figma-local-agent-mcp@${version}`, 'serve']),
    'Agent Plugin MCP arguments must pin the matching npm release.',
  );
  assert(!('env' in server), 'Agent Plugin MCP server must not inject environment variables.');

  const marketplace = await readJson(marketplacePath);
  assert(marketplace.name === 'figma-local-agent', 'Marketplace name is invalid.');
  assert(marketplace.plugins?.length === 1, 'Marketplace must expose exactly one plugin.');
  const entry = marketplace.plugins[0];
  assert(entry.name === plugin.name, 'Marketplace plugin name must match the manifest.');
  assert(entry.source?.source === 'local', 'Marketplace plugin source must be local.');
  assert(
    entry.source?.path === './plugins/figma-local-agent',
    'Marketplace source path must target the portable plugin directory.',
  );
  assert(entry.policy?.installation === 'AVAILABLE', 'Marketplace installation policy is invalid.');
  assert(
    entry.policy?.authentication === 'ON_INSTALL',
    'Marketplace authentication policy is invalid.',
  );

  for (const file of AGENT_PLUGIN_FILES) {
    assert(
      (await stat(resolve(pluginRoot, file))).isFile(),
      `Agent Plugin file is missing: ${file}`,
    );
  }
  for (const forbidden of [
    '.codex-plugin/plugin.json',
    '.cursor-plugin/plugin.json',
    '.mcp.json',
    'gemini-extension.json',
    'hooks/hooks.json',
    'scripts/install.js',
  ]) {
    const exists = await stat(resolve(pluginRoot, forbidden)).then(
      () => true,
      () => false,
    );
    assert(!exists, `Portable Agent Plugin must not contain ${forbidden}.`);
  }

  const skill = await readFile(resolve(pluginRoot, 'skills/figma-local-agent/SKILL.md'), 'utf8');
  assert(!skill.includes('[TODO:'), 'Agent Plugin skill contains an unfinished placeholder.');
  assert(
    skill.includes(`figma-local-agent-mcp@${version} pair`),
    'Agent Plugin skill must document pairing with the matching version.',
  );

  console.log(`Validated portable Agent Plugin v${version}.`);
  return { pluginRoot, version };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await checkAgentPlugin();
}
