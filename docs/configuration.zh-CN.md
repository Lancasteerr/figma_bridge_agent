# 安装与配置

[English](configuration.md)

本文分别说明三种受支持的配置方式：npm 稳定版、滚动更新的 Development build，以及从源码自行编译。无论选择哪一种，Figma 插件和 MCP Server 都必须来自同一版本或同一次构建，不能混用。

## 前置条件

- Windows
- Node.js 20 或更高版本（安装后可通过 `node --version` 和 `where.exe npx` 检查）
- Figma Desktop
- 支持本地 stdio MCP Server 的客户端；ChatGPT Web、Codex Cloud 等纯远程环境无法访问本机 loopback Bridge
- 只有自行编译时才需要 Git 和 pnpm 11.19.0

下文使用 `figma-local-agent` 作为 MCP Server 名称。首次安装或更换构建后，应先导入对应插件并完成一次配对，再重启 MCP 客户端。

## 方式一：使用 npm 稳定版（推荐）

稳定版的 MCP Server 发布在 npm，配套插件发布在项目的 [GitHub Releases](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest)。建议在配置中固定确切版本，不要长期使用 `@latest`，否则 npm 包自动升级后可能与本地插件不匹配。

### 1. 确认并安装匹配版本

在 PowerShell 中查询当前 npm 稳定版本：

```powershell
npm view figma-local-agent-mcp dist-tags.latest
```

将输出记为 `<VERSION>`。从对应的 `v<VERSION>` GitHub Release 下载 `figma-agent-bridge-plugin-v<VERSION>.zip`，解压到不会被移动或删除的目录，然后在 **Figma Desktop → Plugins → Development → Import plugin from manifest** 中选择：

```text
figma-agent-bridge-plugin/manifest.json
```

### 2. 配对插件

在 Figma 中启动 **Local Figma Agent Bridge**，然后运行以下命令；请把 `<VERSION>` 替换为上一步查到的版本号：

```powershell
npx -y figma-local-agent-mcp@<VERSION> pair
```

终端和插件会分别显示六位短码。只有两个短码完全一致时，才在插件中点击 **Codes match**。

### 3. 安装可移植 Agent Plugin（推荐）

支持 Agent Plugins 1.0 的客户端可以导入固定版本的仓库，不再手工维护 MCP 配置。Codex CLI 与 ChatGPT 桌面版可添加仓库 marketplace 并安装其中唯一的插件：

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v0.9.0
codex plugin add figma-local-agent@figma-local-agent
```

安装后重启 ChatGPT 桌面版或新建 Codex 会话。插件的 `mcp.json` 会通过 stdio 启动 `figma-local-agent-mcp@0.9.0`，其 Skill 会指导 Agent 遵循安全的 Proposal 工作流。其他兼容客户端可按自身 Agent Plugins 安装界面，从 `v0.9.0` tag 导入 `plugins/figma-local-agent`。

### 4. 手动 MCP fallback

仅在客户端无法安装 Agent Plugins 1.0 时使用以下方式。

Codex 项目级 `.codex/config.toml`：

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@<VERSION>", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Codex CLI 也可以直接注册：

```powershell
codex mcp add figma-local-agent -- npx.cmd -y figma-local-agent-mcp@<VERSION> serve
```

Claude Code、Claude Desktop、Cursor 或其他支持 stdio 的 MCP 客户端可使用：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npx.cmd",
      "args": ["-y", "figma-local-agent-mcp@<VERSION>", "serve"]
    }
  }
}
```

Windows GUI 应用应使用 `npx.cmd`，而不是 `npx`。保存配置后重启 MCP 客户端。

## 方式二：使用 Development build

[Development build](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/development) 是每次 `master` 分支成功构建后更新的快照，适合提前验证最新改动，不建议用于需要稳定性的环境。该 Release 会滚动更新，因此插件 ZIP 和 MCP tarball 必须在同一次下载中取得。

### 1. 下载并校验构建

下载以下三个文件：

- `figma-agent-bridge-plugin-development.zip`
- `figma-local-agent-mcp-development.tgz`
- `SHA256SUMS`

可在 PowerShell 中查看本地文件的 SHA-256，并与 `SHA256SUMS` 对照：

```powershell
Get-FileHash .\figma-agent-bridge-plugin-development.zip -Algorithm SHA256
Get-FileHash .\figma-local-agent-mcp-development.tgz -Algorithm SHA256
```

将 ZIP 解压到稳定目录，并从 Figma Desktop 导入其中的 `figma-agent-bridge-plugin/manifest.json`。将 `.tgz` 文件也放在不会被移动的固定目录，例如 `C:/Tools/figma-agent/`。

### 2. 使用本地 tarball 配对

先在 Figma 中启动插件，再使用 tarball 的实际绝对路径进行配对。这里必须通过 `--package=file:...` 明确声明本地包，并在 `--` 后指定包内的 CLI：

```powershell
npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp pair
```

不要使用插件界面中可能显示的 npm 配对命令；Development build 应始终使用同一次下载的本地 tarball。

> **不要写成** `npx -y "C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" pair`。当现有文件路径作为 `npx` 的第一个位置参数时，npm 可能先把它识别为要直接执行的命令，而不是待安装的包。Windows 随后会通过 `.tgz` 文件关联打开该文件。显式使用 [`npm exec --package=<pkg> -- <cmd>`](https://docs.npmjs.com/cli/v11/commands/npm-exec/) 可以避免这种歧义。

### 3. 配置 MCP 客户端

Codex 项目级 `.codex/config.toml`：

```toml
[mcp_servers.figma_local_agent]
command = "npm.cmd"
args = ["exec", "--yes", "--package=file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz", "--", "figma-local-agent-mcp", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

通用 stdio JSON：

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

配置中应使用绝对路径，因为 GUI 应用启动时的工作目录通常不是 tarball 所在目录。更新 Development build 时，请同时替换插件目录和 tarball，然后重新启动 Figma 插件及 MCP 客户端。

## 方式三：从源码自行编译

自行编译适合开发、调试或审核源码。推荐直接运行仓库中生成的 CLI bundle，并导入同一次构建生成的插件；不要让 MCP Server 指向一个提交，而插件指向另一个提交。

### 1. 获取源码和依赖

```powershell
git clone https://github.com/Lancasteerr/figma_bridge_agent.git
Set-Location figma_bridge_agent
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

如果已经有仓库，只需进入仓库并确保依赖与当前 `pnpm-lock.yaml` 一致。

### 2. 检查并生成本地产物

```powershell
pnpm build:release
```

该命令会先执行类型检查、代码规范检查、格式检查、测试和构建。供本地直接运行的主要产物为：

```text
apps/mcp-server/dist/cli.js
apps/figma-plugin/dist/manifest.json
```

同时还会在 `artifacts/` 下生成发布格式的文件：

```text
figma-agent-bridge-plugin-v<VERSION>.zip
figma-local-agent-mcp-<VERSION>.tgz
figma-local-agent-plugin-v<VERSION>.zip
SHA256SUMS
```

`<VERSION>` 取自 `apps/figma-plugin/package.json` 和 `apps/mcp-server/package.json`；构建脚本要求两者完全一致。

### 3. 导入、配对并配置

可以从 Figma Desktop 直接导入 `apps/figma-plugin/dist/manifest.json`，也可以解压插件 ZIP 后导入其中的 `figma-agent-bridge-plugin/manifest.json`。然后在仓库根目录直接使用 Node.js 运行编译后的 CLI 完成配对：

```powershell
node .\apps\mcp-server\dist\cli.js pair
```

在 MCP 客户端配置中使用 `dist/cli.js` 的绝对路径。假设仓库位于 `E:/codes/figma_bridge_agent`：

```toml
[mcp_servers.figma_local_agent]
command = "node.exe"
args = ["E:/codes/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

等价的通用 stdio JSON：

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

每次切换提交或重新编译后，应重新运行 `pnpm build:release`，并重新加载或替换插件。`dist/cli.js` 的路径不会随版本号变化，因此 MCP 配置无需随每次构建修改。如果只是修改插件并需要连续构建，可运行 `pnpm --filter @figma-agent/figma-plugin dev`；正式验证时仍应回到 `pnpm build:release` 产物。

如果需要专门验证发布格式的 `.tgz`，请使用 Development build 章节中的显式 `npm exec --package=file:... -- figma-local-agent-mcp` 形式，不要将 `.tgz` 路径直接作为 `npx` 的位置参数。

## 验证与故障排查

使用与当前安装方式相同的命令来源运行 `doctor`。例如 npm 稳定版为：

```powershell
npx -y figma-local-agent-mcp@<VERSION> doctor
```

本地 tarball 为：

```powershell
npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp doctor
```

自行编译版本为：

```powershell
node .\apps\mcp-server\dist\cli.js doctor
```

完成配置后应满足以下条件：

1. Figma 中已打开 **Local Figma Agent Bridge**，且插件窗口保持开启。
2. MCP 客户端能够发现 `figma_status` 等工具。
3. 调用 `figma_status` 能返回当前 Figma 文档、页面和选择信息。

常见问题：

- `PLUGIN_NOT_CONNECTED`：Figma 插件未打开、尚未配对，或插件与 MCP Server 并非同一构建。
- 找不到 `npx.cmd`：安装 Node.js 20+ 后重启 MCP 客户端，并用 `where.exe npx` 检查 PATH。
- 本地 `.tgz` 不存在：文件被移动、删除或配置中的 `--package=file:...` 使用了错误路径；恢复文件或更新为正确的绝对路径。
- 启动 MCP 时桌面打开 `.tgz`：配置仍在使用 `npx <tarball>` 位置参数写法；改用本文给出的 `npm.cmd exec --package=file:... -- figma-local-agent-mcp serve`。
- 3900 端口被旧进程占用：先关闭旧版本的 MCP 客户端任务，再运行 `doctor` 检查。
- 更新后无法自动连接：确认插件和 MCP Server 已同时更新；必要时重新执行 `pair`。

更多客户端示例见[主机配置](hosts.zh-CN.md)，安全边界见[安全说明](security.zh-CN.md)。
