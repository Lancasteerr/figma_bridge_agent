import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { checkAgentPluginArchive } from './check-agent-plugin-archive.mjs';
import { AGENT_PLUGIN_ARCHIVE_ROOT, AGENT_PLUGIN_FILES } from './check-agent-plugin.mjs';

async function createFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'figma-agent-plugin-archive-'));
  const pluginRoot = resolve(temporaryRoot, 'plugin');
  for (const file of AGENT_PLUGIN_FILES) {
    const path = resolve(pluginRoot, file);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, `source:${file}`);
  }
  return { archivePath: resolve(temporaryRoot, 'plugin.zip'), pluginRoot, temporaryRoot };
}

async function writeArchive(archivePath, pluginRoot, { extra, missing, changed } = {}) {
  const archive = new JSZip();
  for (const file of AGENT_PLUGIN_FILES) {
    if (file === missing) continue;
    const content = file === changed ? 'stale content' : await readFile(resolve(pluginRoot, file));
    archive.file(`${AGENT_PLUGIN_ARCHIVE_ROOT}/${file}`, content);
  }
  if (extra) archive.file(`${AGENT_PLUGIN_ARCHIVE_ROOT}/${extra}`, 'unexpected');
  await writeFile(archivePath, await archive.generateAsync({ type: 'nodebuffer' }));
}

async function withFixture(run) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

test('accepts an archive whose file set and contents match the source plugin', async () => {
  await withFixture(async ({ archivePath, pluginRoot }) => {
    await writeArchive(archivePath, pluginRoot);
    const result = await checkAgentPluginArchive(archivePath, { pluginRoot });
    assert.equal(result.files.length, AGENT_PLUGIN_FILES.length);
  });
});

test('reports a missing required file', async () => {
  await withFixture(async ({ archivePath, pluginRoot }) => {
    const missing = 'skills/figma-local-agent/references/design-plan-v1.md';
    await writeArchive(archivePath, pluginRoot, { missing });
    await assert.rejects(
      checkAgentPluginArchive(archivePath, { pluginRoot }),
      new RegExp(`Missing files:[\\s\\S]*${AGENT_PLUGIN_ARCHIVE_ROOT}/${missing}`),
    );
  });
});

test('reports an unexpected file', async () => {
  await withFixture(async ({ archivePath, pluginRoot }) => {
    await writeArchive(archivePath, pluginRoot, { extra: 'unexpected.txt' });
    await assert.rejects(
      checkAgentPluginArchive(archivePath, { pluginRoot }),
      /Unexpected files:[\s\S]*figma-local-agent\/unexpected\.txt/,
    );
  });
});

test('reports archived content that differs from the source file', async () => {
  await withFixture(async ({ archivePath, pluginRoot }) => {
    const changed = 'mcp.json';
    await writeArchive(archivePath, pluginRoot, { changed });
    await assert.rejects(
      checkAgentPluginArchive(archivePath, { pluginRoot }),
      new RegExp(`Content mismatches:[\\s\\S]*${AGENT_PLUGIN_ARCHIVE_ROOT}/${changed}`),
    );
  });
});
