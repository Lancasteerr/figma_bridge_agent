# Local Figma Agent MCP

[English](README.md)

一个本地优先的 MCP 服务器和 Figma Desktop 开发插件，用于读取 Figma Design 文档，并在隔离的 Proposal 副本中创建可审查的修改。

这是通过 GitHub 分发的非官方开发工具，与 Figma 不存在隶属或背书关系，也不会发布到 Figma Community。Figma 文件和凭据只经过本机 loopback，不使用云端中继或遥测。

## Windows 快速开始

环境要求：Windows、Node.js 20 或更高版本、Figma Desktop，以及支持 stdio MCP 的 Coding Agent。普通用户不需要 Git、pnpm 或源码仓库。

1. 从 [GitHub Releases](https://github.com/Lancasteerr/figma_bridge_agent/releases) 下载 `figma-agent-bridge-plugin-v0.2.0.zip`，解压到一个稳定目录。在 **Figma Desktop → Plugins → Development → Import plugin from manifest** 中选择 `figma-agent-bridge-plugin/manifest.json`。
2. 在 Figma 中启动 **Local Figma Agent Bridge**，然后在 PowerShell 运行：

   ```powershell
   npx -y figma-local-agent-mcp@0.2.0 pair
   ```

3. 核对 PowerShell 与插件显示的六位短码，只有完全一致时才点击 **Codes match**。
4. 让 Coding Agent 通过 stdio 启动服务器：

   ```json
   {
     "command": "npx.cmd",
     "args": ["-y", "figma-local-agent-mcp@0.2.0", "serve"]
   }
   ```

首次配对后插件会自动重连。使用桥接期间需要保持插件窗口打开。Codex、ChatGPT Desktop、Claude Code/Desktop 和通用 MCP 客户端示例见[主机配置](docs/hosts.zh-CN.md)。

## Development builds

每次 `master` 成功更新后，都会发布一个滚动更新的 [Development build](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/development) prerelease，包含最新插件 ZIP、MCP tarball、校验和、commit 和构建信息。

这些构建是未经充分测试的开发快照，不是正式稳定版本。请从同一个 Development build 下载插件 ZIP 和 MCP tarball，然后按普通用户流程安装：

1. 解压 `figma-agent-bridge-plugin-development.zip`，在 Figma Desktop 中导入其中的 `figma-agent-bridge-plugin/manifest.json`。
2. 在 tarball 所在目录运行：

   ```powershell
   npx -y ./figma-local-agent-mcp-development.tgz pair
   ```

3. MCP 主机使用 `npx.cmd`，参数依次为 `-y`、`./figma-local-agent-mcp-development.tgz` 和 `serve`。

不要将 Development build 的插件与正式版 MCP 包混用，反之亦然。生产使用请查看[最新稳定版本](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest)。

## 更新与恢复

- 插件 ZIP 与 npm 包必须使用相同版本。更新时覆盖原插件目录，并同步修改 MCP 配置中的版本号。
- `npx -y figma-local-agent-mcp@0.2.0 doctor` 检查本地服务，但不会输出凭据。
- `npx -y figma-local-agent-mcp@0.2.0 devices list` 查看已配对设备。
- `devices revoke <deviceId>` 或 `devices revoke --all` 撤销凭据；被撤销的插件需要重新配对。
- 从 v0.1 升级时会删除旧共享密钥，并要求重新配对一次。升级前先关闭所有 v0.1 MCP 任务，让旧 Daemon 释放 3900 端口。

## 安全边界与工具

桥接工具不会直接修改源稿。所有公开写操作要么创建 Proposal，要么必须提供 Proposal 根节点 ID。普通 Proposal 创建只接收编辑目标，由插件自动解析有界的布局上下文并在编辑前把副本移到 Page；隔离后的整个 Proposal 均可写。声明式布局修改使用有效期五分钟且只能消费一次的验证 ID，并在克隆前重新检查源指纹。

服务器恰好暴露 19 个封闭集合 MCP 工具，覆盖状态/读取、渲染/导出、Proposal 写入和经过验证的布局计划。参见[架构与安全](docs/architecture.zh-CN.md)、[安全说明](docs/security.zh-CN.md)和[验收运行手册](docs/acceptance.zh-CN.md)。

## 开发

贡献者需要 pnpm 11：

```powershell
pnpm install
pnpm check
pnpm build:release
```

`pnpm build:release` 会在 `artifacts/` 下生成可直接导入的插件 ZIP、npm tarball 和 `SHA256SUMS`。贡献者构建仍可通过 `.figma-plugin-id` 覆盖本地 ID，但发行构建始终强制使用 `1685966253180273328`。

Owner 应遵循[手动发布手册](docs/releasing.zh-CN.md)；仅推送提交或 tag 不会自动发布任何版本。

0.2 版本支持多个本地 MCP Adapter、一个活动 Figma 插件和当前 Design 文件的当前页面。Windows 安装器、自动更新、远程传输、云同步、任意 JavaScript、源节点写入、通用删除、分离 Instance 和特定框架代码生成不在本版本范围内。
