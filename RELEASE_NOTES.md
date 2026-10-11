# 2.2.0 release notes

## 中文

这次发布增加会话化 Figma 语义快照。Figma 插件、MCP npm 包和 Agent Plugin 应统一使用 2.2.0；Bridge 协议升级到 v6。

- 新增 `figma_export_semantic_scope`，可把任意节点、组件、区域或页面以 `OUTLINE`/`IMPLEMENTATION` 配置导出为扁平 JSONL；公开结果只返回路径、指纹和摘要。
- 新增 `figma_check_semantic_scope`，可在不重新导出正文的情况下检查已存快照是 `FRESH` 还是 `STALE`。
- 快照按 MCP Adapter session ID 写入 `.figma_bridge_agent/sessions/`，与素材导出共享一次性工作区绑定、路径包含检查、原子写入、SHA-256 和暂存配额。
- 插件在序列化前后校验完整树指纹，并提供结构化截断信息和 12 MiB 语义 RPC 正文上限。
- Agent Plugin Skill 新增按任务范围工作流：单组件直接导出，大范围先读 outline 再按需拆分，用定向 `rg` 查询代替把整个 facts 文件注入上下文。轻量工作单元由 Agent 创建，不复制语义树。
- 公开 MCP 工具总数从 24 增至 26。

## English

This release adds session-persisted Figma semantic snapshots. The Figma plugin, MCP npm package, and Agent Plugin should all use version 2.2.0; the Bridge protocol moves to v6.

- `figma_export_semantic_scope` exports any node, component, region, or page as flat JSONL with `OUTLINE` or `IMPLEMENTATION`; public results contain only paths, fingerprints, and summaries.
- `figma_check_semantic_scope` checks whether a stored snapshot is `FRESH` or `STALE` without re-exporting semantic bodies.
- Snapshots are stored by MCP Adapter session ID below `.figma_bridge_agent/sessions/` and share one-time workspace binding, containment checks, atomic writes, SHA-256, and staged quota with asset exports.
- The plugin fingerprints the complete source tree before and after serialization, reports structured truncation, and enforces a 12 MiB semantic RPC body limit.
- The Agent Plugin Skill now keeps work task-shaped: export a component directly, inspect an outline before splitting large scopes, and use targeted `rg` queries instead of injecting a complete facts file into context. Agent-created lightweight work units reference snapshots without copying their trees.
- The public MCP tool count increases from 24 to 26.

# 2.1.0 release notes

## 中文

这是一次素材交付安全修复。Figma 插件、MCP npm 包和 Agent Plugin 应统一使用 2.1.0；Bridge 协议继续保持 v5。

- MCP Adapter 不再把插件进程的 `process.cwd()` 当作项目目录，所有会话默认进入独立的 24 小时 `STAGED` 暂存目录。
- 新增 `figma_bind_export_root`。Agent 在首次导出前把自身任务执行环境的准确 cwd 与最新 session ID 绑定到当前 Adapter；绑定成功后才直接写入项目。
- 绑定会校验 realpath、目录类型、可写性和危险目录，并拒绝跨会话、改绑、首次写入后的绑定以及与导出并发的绑定。
- 新增 `EXPORT_SESSION_MISMATCH`、`EXPORT_ROOT_INVALID`、`EXPORT_ROOT_CONFLICT` 稳定错误码；并发冲突继续使用可重试的 `BUSY`。
- 未绑定流程仍安全写入暂存目录并返回 `requiresCopy: true`；相对路径、symlink/junction、SHA-256、冲突覆盖、配额和原子写入保护保持不变。
- Agent Plugin Skill、双语文档和验收手册已更新。公开 MCP 工具总数从 23 增至 24。

## English

This release fixes asset-delivery safety. The Figma plugin, MCP npm package, and Agent Plugin should all use version 2.1.0; Bridge protocol v5 remains unchanged.

- MCP Adapters no longer treat the plugin process's `process.cwd()` as the project directory. Every session starts in an independent 24-hour `STAGED` directory.
- `figma_bind_export_root` lets the Agent bind the exact cwd from its own task execution environment, together with the latest session ID, before the first export. Direct project writes begin only after a successful binding.
- Binding validates realpath, directory type, writability, and dangerous locations, and rejects cross-session use, rebinding, binding after the first write, and binding concurrent with export.
- Stable error codes now include `EXPORT_SESSION_MISMATCH`, `EXPORT_ROOT_INVALID`, and `EXPORT_ROOT_CONFLICT`; concurrent conflicts continue to use retryable `BUSY`.
- Unbound export remains safe in staging with `requiresCopy: true`. Existing relative-path, symlink/junction, SHA-256, conflict-overwrite, quota, and atomic-write protections remain intact.
- The Agent Plugin Skill, bilingual documentation, and acceptance runbook are updated. The public MCP tool count increases from 23 to 24.

# 2.0.0 release notes

## 中文

这是一次破坏性接口升级。Figma 插件、MCP npm 包和 Agent Plugin 必须使用同一 2.0.0 版本；Bridge 协议已从 v4 升至 v5。

- `figma_get_node` 与 `figma_get_tree` 现在返回 Image Paint、导出设置、矢量和蒙版事实，并把这些属性纳入节点快照指纹。
- `figma_export_asset` 已替换为 RAW/RENDERED 判别接口。RAW 提取 PNG/JPEG/GIF/WebP 原始字节；RENDERED 支持 PNG/JPG/SVG，并在导出前校验完整子树指纹。
- 每个 MCP Adapter 在启动时冻结 `process.cwd()` 作为唯一工作区根；不可写时使用保留 24 小时的独立暂存会话。不新增环境变量、CLI 参数或 MCP 安装参数。
- 文件交付新增相对路径、realpath、symlink/junction、魔数、配额和原子写入校验，并支持同内容复用与带现有 SHA-256 的显式覆盖。
- `figma_status` 现在返回 `assetExport` 状态。公开导出结果只包含路径、摘要、尺寸和来源信息，不再包含 Base64 或 SVG 正文。
- Agent Plugin Skill 增加“先探查、计划期不导出、实施期重新校验来源”的素材还原流程。

现有调用方必须迁移旧 `figma_export_asset` 输入/输出结构。工具总数保持 23，`figma_render_node` 仍只用于视觉预览。

## English

This is a breaking interface release. The Figma plugin, MCP npm package, and Agent Plugin must all use version 2.0.0; the Bridge protocol moves from v4 to v5.

- `figma_get_node` and `figma_get_tree` now expose Image Paint, export-setting, vector, and mask facts, and include them in node snapshot fingerprints.
- `figma_export_asset` now uses RAW/RENDERED discriminated inputs. RAW extracts original PNG/JPEG/GIF/WebP bytes. RENDERED supports PNG/JPG/SVG and verifies the complete subtree fingerprint first.
- Each MCP Adapter freezes `process.cwd()` as its only workspace root at startup and uses a separate 24-hour staging session only when that root is unwritable. No environment variable, CLI flag, or MCP installation argument is added.
- Delivery now enforces relative paths, realpath and symlink/junction containment, magic bytes, quotas, and atomic writes. Identical content is reused; explicit overwrite requires the existing SHA-256.
- `figma_status` reports `assetExport` state. Public export results contain paths, digests, dimensions, and source information only—never Base64 or SVG bodies.
- The Agent Plugin Skill now follows an inspect-first workflow with no planning-phase export and fresh source validation during implementation.

Existing callers must migrate the old `figma_export_asset` input/output shape. The tool count remains 23, and `figma_render_node` remains a visual-preview tool.
