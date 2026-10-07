# 直接配置 MCP Server

[English](../en-US/install-mcp-server.md) · [选择安装方式](configuration.md) · [文档首页](README.md)

本指南面向 Claude Code、Claude Desktop及其他能够在 Windows 本机启动 stdio MCP Server 的客户端。直接配置会提供与 Agent Plugin 相同的 23 个 MCP 工具，但不会自动安装 `plugins/figma-local-agent/skills/` 中的工作流 Skill。

Claude Code 自身支持插件，但本项目当前没有发布与其插件 marketplace 结构匹配的入口，因此推荐使用本页的直接 stdio 配置。这是正式安装方式，不是降级路径。

## 前置条件

- Windows
- Node.js 20 或更高版本
- Figma Desktop
- 支持本地 stdio MCP Server 的客户端

Windows GUI 应用应使用 `npx.cmd`，而不是 `npx`。以下稳定版示例全部固定到 `0.9.0`，MCP npm 包与 Figma 插件必须保持同一版本。

## 稳定版安装

### 1. 导入匹配的 Figma 插件

从 [v0.9.0 GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v0.9.0) 下载 `figma-agent-bridge-plugin-v0.9.0.zip`，解压到不会被移动或删除的目录。

在 **Figma Desktop → Plugins → Development → Import plugin from manifest** 中选择：

```text
figma-agent-bridge-plugin/manifest.json
```

### 2. 完成首次配对

在 Figma 中启动 **Local Figma Agent Bridge** 并保持窗口打开，然后在 PowerShell 运行：

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

只有终端和插件显示的六位短码完全一致时，才点击 **Codes match**。配对是 Figma 插件与本机 Bridge 的初始化步骤，不会向 MCP 客户端写入配置。

### 3. 添加 stdio MCP Server

只需选择当前客户端对应的一种配置方式。

#### Claude Code

添加用户级 Server：

```powershell
claude mcp add --scope user --transport stdio figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
claude mcp get figma-local-agent
```

若要让项目团队共享配置，可以在项目根目录提交 `.mcp.json`：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npx.cmd",
      "args": ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
    }
  }
}
```

Claude Code 首次读取项目级 `.mcp.json` 时会要求用户信任该 Server。

#### Claude Desktop

在 Claude Desktop 的自定义 MCP 配置中添加：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npx.cmd",
      "args": ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
    }
  }
}
```

#### Codex CLI 与桌面版

CLI 注册：

```powershell
codex mcp add figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
codex mcp list
```

等价的项目级 `.codex/config.toml`：

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

若已安装 Agent Plugin，请不要再使用这一直接配置，否则会加载重复工具。

#### Cursor及其他 stdio 主机

在客户端的 MCP 设置中添加：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npx.cmd",
      "args": ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
    }
  }
}
```

具体配置文件位置和界面名称由主机决定。ChatGPT Web、Codex Cloud 等纯远程环境无法访问本机 Bridge。

### 4. 重启并验证

保存配置后重启 MCP 客户端或新建会话，然后：

1. 确认客户端只加载一个 `figma-local-agent` Server。
2. 确认能发现 `figma_status` 等 23 个工具。
3. 调用 `figma_status`，检查协议 v4、当前 Figma 文件、页面、选区和 Bridge 能力。

直接配置不会自动加载 Agent Plugin Skill。需要了解安全写入顺序时，请阅读 [MCP 工具参考](tools.md)，尤其是 Proposal 与 DesignPlan 流程。

## Development build

[Development Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/development) 是滚动更新的测试构建，只提供 Figma 插件 ZIP 和 MCP tarball，不提供 Agent Plugin。必须在同一次下载中取得：

- `figma-agent-bridge-plugin-development.zip`
- `figma-local-agent-mcp-development.tgz`
- `SHA256SUMS`

校验文件后，把 Figma ZIP 解压并导入其中的 `figma-agent-bridge-plugin/manifest.json`。把 `.tgz` 保存到固定绝对路径，例如 `C:/Tools/figma-agent/`。

配对命令：

```powershell
npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp pair
```

通用 stdio 配置：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npm.cmd",
      "args": [
        "exec",
        "--yes",
        "--package=file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz",
        "--",
        "figma-local-agent-mcp",
        "serve"
      ]
    }
  }
}
```

不要写成 `npx -y <tarball> pair`。npm 可能把现有 `.tgz` 路径识别为要直接执行的命令，导致 Windows 打开该文件。更新 Development build 时应同时替换 Figma 插件目录和 tarball。

## 从源码运行

源码构建适合开发、调试和审核：

```powershell
git clone https://github.com/Lancasteerr/figma_bridge_agent.git
Set-Location figma_bridge_agent
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm build:release
```

从 Figma Desktop 导入 `apps/figma-plugin/dist/manifest.json`，然后在仓库根目录配对：

```powershell
node .\apps\mcp-server\dist\cli.js pair
```

在 MCP 客户端中使用 `dist/cli.js` 的绝对路径。例如仓库位于 `E:/codes/figma_bridge_agent`：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "node.exe",
      "args": ["E:/codes/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"]
    }
  }
}
```

每次切换提交或重新编译后，应重新加载或替换 Figma 插件。不要把一个提交的 Server 与另一个提交的 Figma 插件混用。

## 故障排查

- 稳定版：运行 `npx -y figma-local-agent-mcp@0.9.0 doctor`。
- Development tarball：运行 `npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp doctor`。
- 源码构建：运行 `node .\apps\mcp-server\dist\cli.js doctor`。
- `PLUGIN_NOT_CONNECTED`：Figma 插件未打开、尚未配对，或插件与 Server 不是同一构建。
- 找不到 `npx.cmd`：安装 Node.js 20+ 后重启客户端，并运行 `where.exe npx` 检查 PATH。
- 工具重复：同时安装了 Agent Plugin 和直接 MCP 配置；保留其中一种即可。
- 3900 端口被占用：关闭旧 MCP 客户端任务后重新运行 `doctor`。
