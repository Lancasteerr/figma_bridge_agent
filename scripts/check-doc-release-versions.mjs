import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultWorkspace = resolve(import.meta.dirname, '..');

// 只扫描面向用户和贡献者的文档，避免把真实发行清单误判为文档写死版本。
const documentationTargets = [
  'README.md',
  'README.en-US.md',
  'apps/mcp-server/README.md',
  'docs',
  'plugins/figma-local-agent/skills',
];

// 规则限定到本项目的包名、产物名和发布措辞，允许 Node.js、pnpm、协议及 schema 版本。
const pinnedReleasePatterns = [
  { label: 'npm 包版本', pattern: /figma-local-agent-mcp@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/ },
  {
    label: 'npm 归档版本',
    pattern: /figma-local-agent-mcp-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.tgz/,
  },
  {
    label: '插件归档版本',
    pattern:
      /figma-(?:agent-bridge-plugin|local-agent-plugin)-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.zip/,
  },
  {
    label: 'GitHub Release 标签',
    pattern: /figma_bridge_agent\/releases\/tag\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/,
  },
  {
    label: 'marketplace 版本引用',
    pattern: /figma_bridge_agent(?:\s+--ref\s+|#)v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/,
  },
  {
    label: '稳定版说明',
    pattern: /(?:current stable version is|当前稳定版为)\s+`?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`?/i,
  },
  {
    label: '版本化能力说明',
    pattern: /v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s+(?:supports|支持)/i,
  },
];

async function collectMarkdownFiles(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!entries) return path.endsWith('.md') ? [path] : [];

  const nested = await Promise.all(
    entries.map((entry) => collectMarkdownFiles(resolve(path, entry.name))),
  );
  return nested.flat();
}

/** 查找项目文档中绑定到具体发行版本的引用。 */
export function findPinnedReleaseReferences(documents) {
  const violations = [];
  for (const document of documents) {
    const lines = document.source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { label, pattern } of pinnedReleasePatterns) {
        if (pattern.test(line)) {
          violations.push({ path: document.path, line: index + 1, label, source: line.trim() });
        }
      }
    });
  }
  return violations;
}

/** 校验所有用户文档均使用 VERSION 占位符而不是具体发行号。 */
export async function checkDocReleaseVersions({ workspace = defaultWorkspace } = {}) {
  const files = (
    await Promise.all(
      documentationTargets.map((target) => collectMarkdownFiles(resolve(workspace, target))),
    )
  ).flat();
  const documents = await Promise.all(
    files.map(async (path) => ({
      path: relative(workspace, path).replaceAll('\\', '/'),
      source: await readFile(path, 'utf8'),
    })),
  );
  const violations = findPinnedReleaseReferences(documents);
  if (violations.length > 0) {
    const details = violations
      .map(({ path, line, label, source }) => `${path}:${line} [${label}] ${source}`)
      .join('\n');
    throw new Error(`Documentation must use <VERSION> instead of pinned releases:\n${details}`);
  }

  console.log(`Validated ${documents.length} documentation files without pinned release versions.`);
  return { documents, violations };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await checkDocReleaseVersions();
}
