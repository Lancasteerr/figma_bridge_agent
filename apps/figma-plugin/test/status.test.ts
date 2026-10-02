import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getStatus } from '../src/main/handlers/status.js';

describe('Figma plugin status', () => {
  beforeEach(() => {
    vi.stubGlobal('figma', {
      root: { name: 'Test document' },
      currentPage: { id: '0:1', name: 'Test page', selection: [] },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reports the build-injected plugin package version', () => {
    expect(getStatus().pluginVersion).toBe(__PLUGIN_VERSION__);
  });
});
