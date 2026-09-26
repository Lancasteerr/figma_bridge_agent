# Local Figma Agent MCP

[English](README.md)

一个本地优先的 MCP 服务器和 Figma 开发插件，用于读取 Figma Design 文档，并在隔离的 Proposal 副本中创建可审查的修改。

该桥接工具有意不修改源稿。所有公开的写操作要么创建 Proposal，要么必须提供 Proposal 根节点 ID。声明式布局修改使用有效期五分钟且只能使用一次的验证 ID，并在克隆前立即重新检查源指纹。

## 环境要求

- Node.js 20 或更高版本
- pnpm 11
- 具备当前 Design 文件编辑权限的 Figma Desktop
- 本地 MCP 主机，例如 Codex

## 构建并配对

```powershell
pnpm install
pnpm check
node apps/mcp-server/dist/cli.js setup
```

复制命令输出的配对密钥。在 Figma 中创建一次本地 Development Plugin 条目，将生成的 manifest `id` 复制到仓库根目录下被 git 忽略的 `.figma-plugin-id` 文件中（该文件只包含 ID），然后进行构建：

```powershell
pnpm --filter @figma-agent/figma-plugin build
```

在 Figma Desktop 中选择 **Plugins → Development → Import plugin from manifest**，然后选择 `apps/figma-plugin/dist/manifest.json`。启动 **Local Figma Agent Bridge**，粘贴密钥，并保持其状态窗口打开。

缺少 `.figma-plugin-id` 时，CI 构建会使用不可安装的占位 ID `000000000000000000`；这能让自动化构建保持确定性，但不能替代本地 Figma 生成的 ID。

生成的密钥存储在操作系统用户配置目录中。插件会将粘贴的密钥副本存储在 Figma 的 `clientStorage` 中。这两个值都不应提交到本仓库。

## 运行

MCP 主机应通过 stdio 启动服务器：

```powershell
node E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js serve
```

使用 `doctor` 检查配置和固定的 WebSocket 端口：

```powershell
node apps/mcp-server/dist/cli.js doctor
```

参见[主机配置](docs/hosts.zh-CN.md)、[架构与安全](docs/architecture.zh-CN.md)以及[验收运行手册](docs/acceptance.zh-CN.md)。

## 工具列表

服务器恰好暴露 19 个封闭集合工具：

- 状态/读取：`figma_status`、`figma_get_selection`、`figma_get_node`、`figma_get_tree`、`figma_get_css`、`figma_get_variables`、`figma_get_raw_node`
- 媒体：`figma_render_node`、`figma_export_asset`
- Proposal 写入：`figma_duplicate_as_proposal`、`figma_create_frame`、`figma_reparent_nodes`、`figma_set_layout`、`figma_update_text`、`figma_set_instance_properties`、`figma_create_component_from_node`、`figma_discard_proposal`
- 声明式布局：`figma_validate_layout_plan`、`figma_apply_layout_plan`

所有普通结果都包含结构化内容和紧凑的 JSON 文本回退。PNG 渲染结果还包含 MCP 图像内容和临时本地路径。

## 开发

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

`pnpm check` 会运行完整检查门禁。仓库采用职责聚焦的小型包和处理器；入口只负责组装依赖。

## 范围

0.1 版本支持一个本地 MCP 主机、一个活动中的 Figma 插件，以及当前 Design 文件的当前页面。它不提供任意 JavaScript、源节点写入、通用删除、分离 Instance、远程传输、OAuth、云同步、GRID/WRAP 布局写入或特定框架的代码生成。
