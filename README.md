# Local Figma Agent MCP

让本地 Coding Agent 安全读取 Figma Design 文档，并在隔离的 Proposal 副本中创建可审查的修改。

[English](README.en-US.md) · [中文文档](docs/zh-CN/README.md) · [最新版本](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) · [报告问题](https://github.com/Lancasteerr/figma_bridge_agent/issues)

> 本地优先 · 源稿不可直接修改 · 无云端中继 · 无遥测

这是通过 GitHub 分发的非官方开发工具，与 Figma 不存在隶属或背书关系，也不会发布到 Figma Community。Figma 文件和桥接凭据只经过本机 loopback。

## 能做什么

| 能力         | 说明                                                       |
| ------------ | ---------------------------------------------------------- |
| 本地读取     | 读取当前文件、选区、节点树、样式、变量、字体和 Inspect CSS |
| 视觉检查     | 渲染节点，并把 PNG 或 SVG 导出到自动清理的临时目录         |
| 安全编辑     | 先复制目标和必要布局上下文，再仅在隔离 Proposal 内修改     |
| 声明式生成   | 验证完整 DesignPlan 后，原子创建新的 Proposal              |
| 多客户端复用 | 多个本地 MCP Adapter 共用一个自动管理的 Bridge Daemon      |

MCP Server 当前公开 23 个受限工具。完整列表和推荐调用顺序见 [MCP 工具参考](docs/zh-CN/tools.md)。

## 界面预览

### 首次配对

插件未配对时会显示 PowerShell 命令；开始配对后，终端与插件分别显示需要人工核对的六位短码。

<p align="center">
  <img src="docs/img/plugin-unpaired.png" width="360" alt="Local Figma Agent Bridge 未配对状态" />
  <img src="docs/img/plugin-pairing.png" width="360" alt="Local Figma Agent Bridge 六位短码确认" />
</p>

### 已连接状态

配对完成后，插件窗口会显示 Bridge 连接状态、当前文档和最近连接时间。

<p align="center">
  <img src="docs/img/plugin-connected.png" width="420" alt="Local Figma Agent Bridge 已连接状态" />
</p>

Agent 的修改会出现在 Figma 画布上的隔离 Proposal 中，便于与源设计并排审查。

## 快速开始

### 前置条件

- Windows
- Node.js 20 或更高版本
- Figma Desktop
- 支持本地 stdio MCP 或 Agent Plugins 1.0 的 Coding Agent

普通用户不需要 Git、pnpm 或源码仓库。Figma 插件 ZIP、MCP npm 包和 Agent Plugin 必须来自同一版本；以下示例使用当前稳定版 `0.9.0`。

### 1. 安装 Agent Plugin

支持 Agent Plugins 1.0 的客户端应优先使用可移植 Agent Plugin。Codex CLI 示例：

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v0.9.0
codex plugin add figma-local-agent@figma-local-agent
```

ChatGPT Desktop 添加 marketplace 后需要重启应用，再从 Plugins Directory 安装 **Local Figma Agent**。其他兼容客户端可以从同一 tag 导入 `plugins/figma-local-agent`。不支持 Agent Plugins 的客户端见 [Windows MCP 主机配置](docs/zh-CN/hosts.md)。

### 2. 导入 Figma 插件

从匹配的 [v0.9.0 GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v0.9.0) 下载 `figma-agent-bridge-plugin-v0.9.0.zip`，解压到稳定目录。

在 **Figma Desktop → Plugins → Development → Import plugin from manifest** 中选择：

```text
figma-agent-bridge-plugin/manifest.json
```

### 3. 完成首次配对

在 Figma 中启动 **Local Figma Agent Bridge** 并保持插件窗口打开，然后在 PowerShell 运行：

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

只有终端与插件显示的六位短码完全一致时，才点击 **Codes match**。配对成功后，插件会在后续启动时自动认证并重连。

### 4. 验证连接

重启 MCP 客户端或新建 Agent 会话，然后让 Agent 调用 `figma_status`。正常结果会包含协议 v4、当前 Figma 文件、页面、选区和 Bridge 能力。

Development build、源码构建和完整故障排查见 [安装与配置](docs/zh-CN/configuration.md)。

## 基本使用

1. 在 Figma Desktop 打开目标 Design 文件和 **Local Figma Agent Bridge**。
2. 在 Agent 中先检查 `figma_status`。
3. 在 Figma 中选择要处理的节点，向 Agent 描述读取、修改或生成目标。
4. 在画布中审查生成的 Proposal；公开写工具不会覆盖源稿。

示例请求：

- “读取当前选择，说明它的层级、Auto Layout、字体和视觉样式，不要修改 Figma。”
- “把当前卡片复制为 Proposal，调整间距和标题，然后渲染修改结果供我审查。”
- “使用 DesignPlan 创建新的登录卡片 Proposal，先验证完整计划，再应用并渲染预览。”

## 工作方式

```text
Coding Agent
  ↕ 独立 stdio 会话
MCP Adapter
  ↕ 已认证的 ws://127.0.0.1:3900/mcp
Local Bridge Daemon
  ↕ 每设备认证的 ws://127.0.0.1:3900/
Figma 插件 UI 与主进程
  ↕ Figma Plugin API
当前 Design 文件的当前页面
```

首次配对由用户核对六位短码。之后每个插件设备使用独立凭据和新鲜 proof 认证。Bridge 只监听 `127.0.0.1`，不提供远程或云端传输。

修改现有设计时，Bridge 会把目标与必要布局上下文复制到 Page 级 Proposal；连续写入使用完整树指纹保护并发编辑。从零生成复杂界面时，Agent 可以先验证 DesignPlan，再使用五分钟内单次有效的验证 ID 原子创建 Proposal。

实现细节见 [架构与安全模型](docs/zh-CN/architecture.md)。

## 安全边界

- 公开写工具只能新建 Proposal，或修改带 Bridge 标记的 Proposal 根内部节点。
- 输入素材只接受 Base64；Server 不抓取 URL，也不读取调用方指定的本地文件。
- Team Library 不会被查询；需要复用的外部 Instance 必须先放到当前页面。
- 导出内容只写入临时目录并带 SHA-256，会话结束后清理。
- 同一时间只支持一个活动 Figma 插件窗口；纯远程 Agent 无法访问本机 Bridge。

完整边界和操作建议见 [安全说明](docs/zh-CN/security.md)。

## 文档

| 文档                                         | 适用对象             | 内容                                        |
| -------------------------------------------- | -------------------- | ------------------------------------------- |
| [文档首页](docs/zh-CN/README.md)             | 所有人               | 按任务选择文档                              |
| [安装与配置](docs/zh-CN/configuration.md)    | 使用者               | 稳定版、Development build、源码构建与排障   |
| [MCP 工具参考](docs/zh-CN/tools.md)          | 使用者、Agent 开发者 | 23 个工具、写入边界和调用流程               |
| [架构与安全模型](docs/zh-CN/architecture.md) | 开发者               | 进程、协议、Proposal 和 DesignPlan 生命周期 |
| [开发指南](docs/zh-CN/development.md)        | 贡献者               | Monorepo、常用命令、测试和构建              |
| [端到端验收](docs/zh-CN/acceptance.md)       | 贡献者               | 发行产物和 Figma 场景验收                   |

## 本地开发

贡献者需要 Node.js 20+ 和 pnpm 11.19.0：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build:release
```

`pnpm check` 会执行 Agent Plugin 校验、类型检查、Lint、格式检查、测试和构建。`pnpm build:release` 会在 `artifacts/` 下生成 Figma 插件 ZIP、npm tarball、可移植 Agent Plugin ZIP 和 `SHA256SUMS`。

开发环境和仓库结构见 [开发指南](docs/zh-CN/development.md)。

## 当前范围

v0.9.0 支持 Windows、本地 stdio、多个 MCP Adapter、一个活动 Figma 插件，以及当前 Design 文件的当前页面。它支持读取、渲染、导出、受控 Proposal 编辑和已验证的 DesignPlan。

当前不提供 Windows 安装器、自动更新、远程传输、云同步、任意 JavaScript、源稿直接写入、通用删除、Instance 分离、Team Library 查询或框架代码生成。

## License

本项目基于 [MIT License](LICENSE) 发布。使用生成的 Proposal 或导出内容前，请在自己的环境中完成审查。
