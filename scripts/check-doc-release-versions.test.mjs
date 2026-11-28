import assert from 'node:assert/strict';
import test from 'node:test';

import { findPinnedReleaseReferences } from './check-doc-release-versions.mjs';

test('reports project-specific pinned release references', () => {
  const source = [
    'figma-local-agent-mcp@3.0.2',
    'figma-local-agent-mcp-3.0.2.tgz',
    'figma-agent-bridge-plugin-v3.0.2.zip',
    'figma-local-agent-plugin-v3.0.2.zip',
    'https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v3.0.2',
    'codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v3.0.2',
    'copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v3.0.2',
    'The current stable version is `3.0.2`.',
    'v3.0.2 supports Windows.',
  ].join('\n');

  const violations = findPinnedReleaseReferences([{ path: 'README.md', source }]);
  assert.equal(violations.length, 9);
});

test('allows runtime, dependency, protocol, schema, and acceptance candidate versions', () => {
  const source = [
    // 候选版本用于验收记录，安装命令仍由发行版本占位符生成。
    'The release candidate is `3.0.2`.',
    '本次候选发行版本为 `3.0.2`。',
    'Node.js 20 or newer and pnpm 11.19.0 are required.',
    'The status response uses protocol v4.',
    'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    'eslint 9.36.0 is a development dependency.',
  ].join('\n');

  const violations = findPinnedReleaseReferences([{ path: 'development.md', source }]);
  assert.deepEqual(violations, []);
});
