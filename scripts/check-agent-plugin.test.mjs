import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { AGENT_PLUGIN_FILES, validatePackagedMarkdownLinks } from './check-agent-plugin.mjs';

async function withPlugin(files, run) {
  const root = await mkdtemp(join(tmpdir(), 'figma-agent-plugin-links-'));
  try {
    for (const [path, source] of Object.entries(files)) {
      const absolute = resolve(root, path);
      await mkdir(resolve(absolute, '..'), { recursive: true });
      await writeFile(absolute, source);
    }
    await run(root, Object.keys(files));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('accepts local Markdown links whose targets are packaged', async () => {
  await withPlugin(
    {
      'skills/example/SKILL.md': '[Guide](references/guide.md)',
      'skills/example/references/guide.md': '[Section](#details) [Docs](https://example.com)',
    },
    async (root, files) => {
      await validatePackagedMarkdownLinks(root, files);
    },
  );
});

test('rejects a local Markdown target omitted from the package', async () => {
  await withPlugin(
    {
      'skills/example/SKILL.md': '[Missing](references/missing.md)',
    },
    async (root, files) => {
      await assert.rejects(
        validatePackagedMarkdownLinks(root, files),
        /Packaged Markdown link target is missing/,
      );
    },
  );
});

test('rejects a Markdown link that escapes the plugin root', async () => {
  await withPlugin(
    {
      'skills/example/SKILL.md': '[Outside](../../../outside.md)',
    },
    async (root, files) => {
      await assert.rejects(
        validatePackagedMarkdownLinks(root, files),
        /Packaged Markdown link escapes the plugin root/,
      );
    },
  );
});

test('keeps cold-start skill context within budget and all packaged references resolvable', async () => {
  const pluginRoot = resolve(import.meta.dirname, '../plugins/figma-local-agent');
  const skill = await readFile(resolve(pluginRoot, 'skills/figma-local-agent/SKILL.md'), 'utf8');
  const frontend = await readFile(
    resolve(pluginRoot, 'skills/figma-local-agent/references/frontend-implementation.md'),
    'utf8',
  );

  assert.ok(skill.length <= 4_500, `SKILL.md is ${skill.length} characters.`);
  assert.ok(
    skill.length + frontend.length <= 10_000,
    `Cold-start plus front-end reference is ${skill.length + frontend.length} characters.`,
  );
  await validatePackagedMarkdownLinks(pluginRoot, AGENT_PLUGIN_FILES);
});
