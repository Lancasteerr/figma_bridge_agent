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
