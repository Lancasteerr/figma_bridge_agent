import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { MARKETPLACE_TARGETS, syncAgentMarketplaces } from './sync-agent-marketplaces.mjs';

const plugin = {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'figma-local-agent',
  version: '0.9.0',
  description:
    'Read local Figma designs and create reviewable Proposal changes through the Local Figma Agent Bridge.',
  author: { name: 'Lancasteerr', url: 'https://github.com/Lancasteerr' },
  homepage: 'https://github.com/Lancasteerr/figma_bridge_agent',
  repository: 'https://github.com/Lancasteerr/figma_bridge_agent',
  license: 'MIT',
  keywords: ['figma', 'design', 'mcp', 'local-first'],
};

function createMarketplaces() {
  const shared = {
    name: plugin.name,
    owner: { name: plugin.author.name },
    metadata: { description: 'Marketplace description', version: plugin.version },
    plugins: [
      {
        name: plugin.name,
        source: 'plugins/figma-local-agent',
        description: plugin.description,
        version: plugin.version,
        author: plugin.author,
        homepage: plugin.homepage,
        repository: plugin.repository,
        license: plugin.license,
        keywords: plugin.keywords,
      },
    ],
  };
  return {
    codex: {
      name: plugin.name,
      interface: { displayName: 'Local Figma Agent' },
      plugins: [
        {
          name: plugin.name,
          source: { source: 'local', path: './plugins/figma-local-agent' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Productivity',
        },
      ],
    },
    cursor: structuredClone(shared),
    copilot: {
      ...structuredClone(shared),
      plugins: [{ ...structuredClone(shared.plugins[0]), category: 'Productivity' }],
    },
  };
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function createFixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'figma-agent-marketplaces-'));
  await writeJson(resolve(workspace, 'package.json'), { version: plugin.version });
  await writeJson(resolve(workspace, 'plugins/figma-local-agent/plugin.json'), plugin);
  const marketplaces = createMarketplaces();
  for (const target of MARKETPLACE_TARGETS) {
    await writeJson(resolve(workspace, target.source), marketplaces[target.platform]);
  }
  return { marketplaces, workspace };
}

async function withFixture(run) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.workspace, { recursive: true, force: true });
  }
}

test('writes and validates every platform entry point', async () => {
  await withFixture(async ({ workspace }) => {
    await syncAgentMarketplaces({ workspace, mode: 'write' });
    await syncAgentMarketplaces({ workspace, mode: 'check' });

    for (const target of MARKETPLACE_TARGETS) {
      const source = await readFile(resolve(workspace, target.source), 'utf8');
      const output = await readFile(resolve(workspace, target.output), 'utf8');
      assert.equal(output, source);
    }
  });
});

test('reports a missing generated entry point', async () => {
  await withFixture(async ({ workspace }) => {
    await syncAgentMarketplaces({ workspace, mode: 'write' });
    await unlink(resolve(workspace, MARKETPLACE_TARGETS[1].output));
    await assert.rejects(
      syncAgentMarketplaces({ workspace, mode: 'check' }),
      /Generated cursor marketplace is missing/,
    );
  });
});

test('reports a stale generated entry point', async () => {
  await withFixture(async ({ workspace }) => {
    await syncAgentMarketplaces({ workspace, mode: 'write' });
    await writeFile(resolve(workspace, MARKETPLACE_TARGETS[2].output), '{}\n');
    await assert.rejects(
      syncAgentMarketplaces({ workspace, mode: 'check' }),
      /Generated copilot marketplace is stale/,
    );
  });
});

test('rejects marketplace version drift', async () => {
  await withFixture(async ({ marketplaces, workspace }) => {
    marketplaces.cursor.plugins[0].version = '0.9.1';
    await writeJson(resolve(workspace, MARKETPLACE_TARGETS[1].source), marketplaces.cursor);
    await assert.rejects(
      syncAgentMarketplaces({ workspace, mode: 'write' }),
      /Cursor plugin version must match the portable manifest/,
    );
  });
});

test('rejects an incorrect plugin source', async () => {
  await withFixture(async ({ marketplaces, workspace }) => {
    marketplaces.copilot.plugins[0].source = 'plugins/wrong-plugin';
    await writeJson(resolve(workspace, MARKETPLACE_TARGETS[2].source), marketplaces.copilot);
    await assert.rejects(
      syncAgentMarketplaces({ workspace, mode: 'write' }),
      /Copilot marketplace source must target plugins\/figma-local-agent/,
    );
  });
});

test('rejects a missing required owner', async () => {
  await withFixture(async ({ marketplaces, workspace }) => {
    delete marketplaces.cursor.owner;
    await writeJson(resolve(workspace, MARKETPLACE_TARGETS[1].source), marketplaces.cursor);
    await assert.rejects(
      syncAgentMarketplaces({ workspace, mode: 'write' }),
      /Cursor owner must match plugin author/,
    );
  });
});
