# 安装 Agent Plugin

[English](../en-US/install-plugin.md) · [选择安装方式](configuration.md) · [文档首页](README.md)

本指南面向当前已适配本项目 Agent Plugin 的 Codex、GitHub Copilot 和 Cursor。插件会同时安装：

- 固定到匹配发行版本的本地 stdio MCP Server 启动配置；
- 指导 Agent 安全读取 Figma、创建隔离 Proposal 和使用 DesignPlan 的 Skill。

安装 Agent Plugin 后不要再手工注册名为 `figma-local-agent` 的 MCP Server，否则同一客户端可能加载重复工具。本路线只支持稳定版；Development Release 当前不提供 Agent Plugin。

## 前置条件

- Windows
- Node.js 20 或更高版本
- Figma Desktop
- Codex、GitHub Copilot 或 Cursor 的受支持本地版本

打开 [GitHub 最新版本页面](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest)，记下不含 `v` 前缀的版本号，并用它替换本页所有 `<VERSION>`。Agent Plugin、MCP npm 包和 Figma 插件 ZIP 必须保持同一版本。

## 1. 安装 Agent Plugin

只需选择当前客户端对应的一种方法。

### Codex CLI 与 ChatGPT 桌面版

在 PowerShell 中导入固定版本的仓库 marketplace：

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v<VERSION>
```

然后在 Codex 中运行 `/plugins`，选择 `figma-local-agent` marketplace，并安装 **Local Figma Agent**。

### GitHub Copilot CLI

```powershell
copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v<VERSION>
copilot plugin install figma-local-agent@figma-local-agent
```

如果只想安装插件而不注册 marketplace，可以使用：

```powershell
copilot plugin install Lancasteerr/figma_bridge_agent:plugins/figma-local-agent
```

### Cursor

1. 团队管理员进入 **Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo**。
2. 导入 `https://github.com/Lancasteerr/figma_bridge_agent`。
3. 开发者在 **Customize** 中找到 **Local Figma Agent**，选择 **Install**，并指定 user 或 project scope。

本地开发时，可以把 `plugins/figma-local-agent` 复制到 `~/.cursor/plugins/local/figma-local-agent` 后重新加载 Cursor。团队版还需要管理员允许 Local Plugin Imports。

## 2. 导入匹配的 Figma 插件

从 [GitHub 最新版本页面](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) 下载 `figma-agent-bridge-plugin-v<VERSION>.zip`，解压到不会被移动或删除的目录。

在 **Figma Desktop → Plugins → Development → Import plugin from manifest** 中选择：

```text
figma-agent-bridge-plugin/manifest.json
```

本项目是通过 GitHub 分发的非官方开发工具，不会发布到 Figma Community。

## 3. 完成首次配对

配对是 Figma 插件与本机 Bridge 的共同初始化步骤，不是另一种 MCP 安装方式。

1. 在 Figma 中启动 **Local Figma Agent Bridge** 并保持窗口打开。
2. 在 PowerShell 运行：

   ```powershell
   npx -y figma-local-agent-mcp@<VERSION> pair
   ```

3. 终端和 Figma 插件会分别显示六位短码。只有两个短码完全一致时，才在插件中点击 **Codes match**。

配对成功后，插件会保存独立设备凭据并在后续启动时自动认证。命令不会把凭据写入 Agent Plugin。

## 4. 重启并验证

重启 ChatGPT/Cursor，或为 Codex、Copilot 新建 Agent 会话，使新安装的插件生效。然后：

1. 确认客户端只加载一个 `figma-local-agent` MCP Server。
2. 让 Agent 调用 `figma_status`。
3. 确认结果包含协议 v4、当前 Figma 文件、页面、选区和 Bridge 能力。
4. 确认 **Local Figma Agent** Skill 可用，并能指导 Agent 使用 Proposal 工作流。

## 更新与排查

- 更新时同时升级 Agent Plugin 和 Figma 插件，不要让 `mcp.json` 中的 npm 版本与 Figma 插件版本不同。
- 插件未出现在客户端时，刷新或重新导入 marketplace，并确认使用的是包含对应平台入口的 `v<VERSION>` tag。
- 工具重复出现时，删除此前手工添加的同名 MCP Server，再新建会话。
- `PLUGIN_NOT_CONNECTED` 表示 Figma 插件没有打开、尚未配对，或组件版本不匹配。
- 可运行 `npx -y figma-local-agent-mcp@<VERSION> doctor` 检查本机 Bridge 状态。

若客户端没有本项目适配的 Agent Plugin 入口，请改用[直接配置 MCP Server](install-mcp-server.md)。
