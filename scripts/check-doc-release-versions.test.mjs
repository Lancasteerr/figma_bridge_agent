import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkDocReleaseVersions,
  findPinnedReleaseReferences,
} from './check-doc-release-versions.mjs';

test('accepts the repository documentation placeholders', async () => {
  const result = await checkDocReleaseVersions();
  assert.deepEqual(result.violations, []);
});

test('reports project-specific pinned release references', () => {
  const source = [
    'figma-local-agent-mcp@1.2.3',
    'figma-local-agent-mcp-1.2.3.tgz',
    'figma-agent-bridge-plugin-v1.2.3.zip',
    'figma-local-agent-plugin-v1.2.3.zip',
    'https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v1.2.3',
    'codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v1.2.3',
    'copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v1.2.3',
    'The current stable version is `1.2.3`.',
    'v1.2.3 supports Windows.',
  ].join('\n');

  const violations = findPinnedReleaseReferences([{ path: 'README.md', source }]);
  assert.equal(violations.length, 9);
});

test('allows runtime, dependency, protocol, and schema versions', () => {
  const source = [
    'Node.js 20 or newer and pnpm 11.19.0 are required.',
    'The status response uses protocol v4.',
    'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    'eslint 9.36.0 is a development dependency.',
  ].join('\n');

  const violations = findPinnedReleaseReferences([{ path: 'development.md', source }]);
  assert.deepEqual(violations, []);
});
