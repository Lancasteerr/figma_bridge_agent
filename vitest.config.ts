import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

const mcpPackage = JSON.parse(
  readFileSync(new URL('./apps/mcp-server/package.json', import.meta.url), 'utf8'),
) as { version: string };
const pluginPackage = JSON.parse(
  readFileSync(new URL('./apps/figma-plugin/package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  // 测试环境复用各应用构建时的版本注入，避免测试再次维护第三份版本号。
  define: {
    __CLI_VERSION__: JSON.stringify(mcpPackage.version),
    __PLUGIN_VERSION__: JSON.stringify(pluginPackage.version),
  },
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    coverage: { reporter: ['text', 'html'] },
  },
});
