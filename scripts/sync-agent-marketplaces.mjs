import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const defaultWorkspace = resolve(import.meta.dirname, '..');
const pluginDirectory = 'plugins/figma-local-agent';

export const MARKETPLACE_TARGETS = [
  {
    platform: 'codex',
    source: '.agents/marketplaces/codex/marketplace.json',
    output: '.agents/plugins/marketplace.json',
  },
  {
    platform: 'cursor',
    source: '.agents/marketplaces/cursor/marketplace.json',
    output: '.cursor-plugin/marketplace.json',
  },
  {
    platform: 'copilot',
    source: '.agents/marketplaces/copilot/marketplace.json',
    output: '.github/plugin/marketplace.json',
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path, label) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`);
    throw error;
  }

  try {
    return { data: JSON.parse(source), source };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${path}\n${error.message}`);
  }
}

async function formatJson(data, prettierConfig) {
  return format(JSON.stringify(data), { ...prettierConfig, parser: 'json' });
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, '\n');
}

function validatePortableMetadata(packageMetadata, plugin) {
  assert(
    /^\d+\.\d+\.\d+$/.test(packageMetadata.version),
    'Workspace version must use strict semantic versioning.',
  );
  assert(
    plugin.version === packageMetadata.version,
    `Agent Plugin version must equal workspace version ${packageMetadata.version}.`,
  );
  assert(plugin.name === 'figma-local-agent', 'Agent Plugin name is invalid.');
  assert(
    typeof plugin.description === 'string' && plugin.description,
    'Plugin description is required.',
  );
  assert(
    typeof plugin.author?.name === 'string' && plugin.author.name,
    'Plugin author is required.',
  );
  assert(typeof plugin.homepage === 'string' && plugin.homepage, 'Plugin homepage is required.');
  assert(
    typeof plugin.repository === 'string' && plugin.repository,
    'Plugin repository is required.',
  );
  assert(typeof plugin.license === 'string' && plugin.license, 'Plugin license is required.');
  assert(
    Array.isArray(plugin.keywords) && plugin.keywords.length > 0,
    'Plugin keywords are required.',
  );
}

function validateCommonMarketplace(marketplace, plugin, platform) {
  assert(marketplace.name === 'figma-local-agent', `${platform} marketplace name is invalid.`);
  assert(
    Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1,
    `${platform} marketplace must expose exactly one plugin.`,
  );
  const entry = marketplace.plugins[0];
  assert(entry.name === plugin.name, `${platform} plugin name must match the portable manifest.`);
  return entry;
}

function validateCodexMarketplace(marketplace, plugin) {
  const entry = validateCommonMarketplace(marketplace, plugin, 'Codex');
  assert(
    marketplace.interface?.displayName === 'Local Figma Agent',
    'Codex marketplace display name is invalid.',
  );
  assert(entry.source?.source === 'local', 'Codex marketplace source must be local.');
  assert(
    entry.source?.path === `./${pluginDirectory}`,
    `Codex marketplace source must target ./${pluginDirectory}.`,
  );
  assert(entry.policy?.installation === 'AVAILABLE', 'Codex installation policy is invalid.');
  assert(entry.policy?.authentication === 'ON_INSTALL', 'Codex authentication policy is invalid.');
  assert(entry.category === 'Productivity', 'Codex marketplace category is invalid.');
}

function validateSharedMarketplace(marketplace, plugin, platform) {
  const entry = validateCommonMarketplace(marketplace, plugin, platform);
  assert(
    marketplace.owner?.name === plugin.author.name,
    `${platform} owner must match plugin author.`,
  );
  assert(
    typeof marketplace.metadata?.description === 'string' && marketplace.metadata.description,
    `${platform} marketplace description is required.`,
  );
  assert(
    marketplace.metadata?.version === plugin.version,
    `${platform} marketplace version must equal ${plugin.version}.`,
  );
  assert(
    entry.source === pluginDirectory,
    `${platform} marketplace source must target ${pluginDirectory}.`,
  );
  for (const field of ['description', 'version', 'homepage', 'repository', 'license']) {
    assert(
      entry[field] === plugin[field],
      `${platform} plugin ${field} must match the portable manifest.`,
    );
  }
  assert(
    isDeepStrictEqual(entry.author, plugin.author),
    `${platform} plugin author must match the portable manifest.`,
  );
  assert(
    isDeepStrictEqual(entry.keywords, plugin.keywords),
    `${platform} plugin keywords must match the portable manifest.`,
  );
  return entry;
}

function validateMarketplace(platform, marketplace, plugin) {
  if (platform === 'codex') {
    validateCodexMarketplace(marketplace, plugin);
    return;
  }

  const entry = validateSharedMarketplace(
    marketplace,
    plugin,
    platform === 'cursor' ? 'Cursor' : 'Copilot',
  );
  if (platform === 'copilot') {
    assert(entry.category === 'Productivity', 'Copilot marketplace category is invalid.');
  }
}

export async function syncAgentMarketplaces({ workspace = defaultWorkspace, mode = 'check' } = {}) {
  assert(mode === 'check' || mode === 'write', `Unsupported marketplace sync mode: ${mode}`);

  const [{ data: packageMetadata }, { data: plugin }] = await Promise.all([
    readJson(resolve(workspace, 'package.json'), 'Workspace package metadata'),
    readJson(resolve(workspace, pluginDirectory, 'plugin.json'), 'Agent Plugin manifest'),
  ]);
  validatePortableMetadata(packageMetadata, plugin);
  const prettierConfig = (await resolveConfig(resolve(workspace, 'package.json'))) ?? {};

  const marketplaces = await Promise.all(
    MARKETPLACE_TARGETS.map(async (target) => {
      const path = resolve(workspace, target.source);
      const { data } = await readJson(path, `${target.platform} marketplace source`);
      validateMarketplace(target.platform, data, plugin);
      return { ...target, data, formatted: await formatJson(data, prettierConfig) };
    }),
  );

  if (mode === 'write') {
    for (const marketplace of marketplaces) {
      const sourcePath = resolve(workspace, marketplace.source);
      const outputPath = resolve(workspace, marketplace.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(sourcePath, marketplace.formatted);
      await writeFile(outputPath, marketplace.formatted);
    }
    console.log(`Synchronized ${marketplaces.length} Agent Plugin marketplace adapters.`);
  } else {
    for (const marketplace of marketplaces) {
      const outputPath = resolve(workspace, marketplace.output);
      let output;
      try {
        output = await readFile(outputPath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new Error(
            `Generated ${marketplace.platform} marketplace is missing: ${marketplace.output}. Run pnpm sync:agent-marketplaces.`,
          );
        }
        throw error;
      }
      assert(
        normalizeLineEndings(output) === normalizeLineEndings(marketplace.formatted),
        `Generated ${marketplace.platform} marketplace is stale: ${marketplace.output}. Run pnpm sync:agent-marketplaces.`,
      );
    }
    console.log(`Validated ${marketplaces.length} Agent Plugin marketplace adapters.`);
  }

  return { plugin, version: plugin.version, marketplaces };
}

function parseMode(args) {
  assert(args.length <= 1, 'Use exactly one of --check or --write.');
  const option = args[0] ?? '--check';
  assert(option === '--check' || option === '--write', `Unknown option: ${option}`);
  return option.slice(2);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await syncAgentMarketplaces({ mode: parseMode(process.argv.slice(2)) });
}
