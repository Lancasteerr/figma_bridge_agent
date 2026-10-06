# Local Figma Agent MCP

让本地 Coding Agent 安全读取 Figma Design 文档，并在隔离的 Proposal 副本中创建可审查的修改。

[English](README.en-US.md) · [快速开始](#快速开始) · [最新版本](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) · [报告问题](https://github.com/Lancasteerr/figma_bridge_agent/issues) · [详细配置](docs/zh-CN/configuration.md)

> 本地优先 · 源稿不可直接修改 · 无云端中继 · 无遥测

这是通过 GitHub 分发的非官方开发工具，与 Figma 不存在隶属或背书关系，也不会发布到 Figma Community。Figma 文件和桥接凭据只经过本机 loopback。

## 目录

- [简介](#简介)
- [核心特性](#核心特性)
- [界面预览](#界面预览)
- [工作原理](#工作原理)
- [快速开始](#快速开始)
- [配置 MCP 客户端](#配置-mcp-客户端)
- [快速使用](#快速使用)
- [MCP 工具列表](#mcp-工具列表)
- [安全边界与限制](#安全边界与限制)
- [更新、恢复与故障排查](#更新恢复与故障排查)
- [项目结构与开发](#项目结构与开发)
- [版本范围](#版本范围)
- [免责声明与 License](#免责声明与-license)

## 简介

Local Figma Agent MCP 把本机 Coding Agent 与当前打开的 Figma Design 文件连接起来。Agent 可以读取节点、结构、样式、字体和渲染结果，也可以创建或修改隔离的 Proposal；公开工具不会直接改写源稿。

项目由三个协作部分组成：

| 组件               | 作用                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| **Agent Plugin**   | 安装 Agent 工作流说明，并自动配置 stdio MCP Server                          |
| **MCP Server**     | 向 Agent 暴露 23 个受限工具，管理本地 Daemon、认证、校验和临时资源          |
| **Figma 开发插件** | 在 Figma Desktop 内读取当前文档，并通过 Figma Plugin API 执行 Proposal 操作 |

本项目适合本机设计读取、设计审查、受控修改和声明式界面生成。它需要 Windows、Figma Desktop 和支持本地 stdio MCP 的客户端；ChatGPT Web、Codex Cloud 等纯远程环境无法访问本机 Bridge。

## 核心特性

| 特性              | 说明                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| 🔒 本地数据链路   | Figma 数据、配对凭据和 RPC 流量都留在本机，不经过云端中继                  |
| 🧪 Proposal 隔离  | 编辑现有设计前先复制到 Page 级 Proposal，源节点不会被公开写工具修改        |
| 👁️ 结构与视觉读取 | 支持节点、子树、变量、字体、CSS 提示、PNG 渲染及 PNG/SVG 导出              |
| 🛠️ 受控编辑       | 支持布局、文本、层级、组件和 Instance 属性操作，写入范围受 Proposal 根限制 |
| 📐 DesignPlan     | 可先验证完整声明式设计计划，再用单次验证 ID 原子创建 Proposal              |
| 🔁 多客户端复用   | 多个本地 MCP Adapter 可以复用一个自动管理的 Bridge Daemon                  |

## 界面预览

截图文件统一存放在 [`docs/img`](docs/img/README.md)。以下位置已按插件窗口和 Figma 画布两种画幅预留；图片到位后取消对应 HTML 注释即可，不会在当前 README 中显示破损图片。

### 首次配对

未配对状态展示 PowerShell 命令；开始配对后，终端与插件会分别显示需要人工核对的六位短码。

<p align="center">
  <img src="docs/img/plugin-unpaired.png" width="360" alt="Local Figma Agent Bridge 未配对状态" />
  <img src="docs/img/plugin-pairing.png" width="360" alt="Local Figma Agent Bridge 六位短码确认" />
</p>

### 已连接状态

配对完成后，插件窗口会显示 Bridge 连接状态、当前文档和最近连接时间。

<p align="center">
  <img src="docs/img/plugin-connected.png" width="420" alt="Local Figma Agent Bridge 已连接状态" />
</p>

### Proposal 审查

Agent 的修改会出现在隔离的 Proposal 中，便于在 Figma 画布上与源设计并排检查。

## 工作原理

### 进程与数据链路

```text
Coding Agent（Codex / Claude Code / Cursor 等）
  ↕ 独立 stdio 会话
MCP Adapter
  ↕ 已认证的 ws://127.0.0.1:3900/mcp
Local Bridge Daemon
  ↕ 每设备认证的 ws://127.0.0.1:3900/
Figma 插件 UI
  ↕ 已校验的 postMessage
Figma 插件主进程
  ↕ Figma Plugin API
当前 Design 文件的当前页面
```

Agent Plugin 只是分发层，不接收 Figma 数据。每个 MCP 客户端拥有独立的 stdio Adapter；首个 Adapter 按需启动 Daemon，多个 Adapter 复用同一插件连接。最后一个 Adapter 与插件都断开后，Daemon 会在 30 秒后自动退出。

首次使用时，CLI 和 Figma 插件分别显示六位短码。用户确认两端短码一致后，插件获得独立设备凭据；后续启动会自动认证并重连。正常运行时 Bridge 只监听 `127.0.0.1`。

### 修改现有设计

```text
读取源稿 → 复制目标和必要布局上下文 → 创建隔离 Proposal
        → 在 Proposal 内修改 → 重新读取或渲染 → 用户在 Figma 中审查
```

`figma_duplicate_as_proposal` 会自动解析有界的布局上下文，把副本移动到 Page 后再开放写入。后续写工具必须携带 Proposal 根 ID；修改操作返回的新指纹应作为下一次操作的 `expectedFingerprint`，避免覆盖并发编辑。

### 从零生成设计

复杂设计可以使用 DesignPlan：Agent 先读取字体、资源及可选来源指纹，再提交完整计划进行只读验证。验证成功会返回一个五分钟内有效、只能消费一次的验证 ID；`figma_apply_design_plan` 在重新检查来源与资源后原子创建 Proposal。验证或写入失败不会留下半成品设计。

更多细节见[架构说明](docs/zh-CN/architecture.md)和[安全说明](docs/zh-CN/security.md)。

## 快速开始

### 前置条件

- Windows
- Node.js 20 或更高版本
- Figma Desktop
- 支持本地 stdio MCP 或 Agent Plugins 1.0 的 Coding Agent

普通用户不需要 Git、pnpm 或源码仓库。Figma 插件 ZIP 与 MCP npm 包必须来自同一版本，本节固定使用 `0.9.0`。

### 1. 安装 Agent Plugin

支持 Agent Plugins 1.0 的客户端应优先使用可移植 Agent Plugin。Codex CLI 示例：

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v0.9.0
codex plugin add figma-local-agent@figma-local-agent
```

ChatGPT Desktop 添加 marketplace 后需要重启应用，再从 Plugins Directory 安装 **Local Figma Agent**。其他兼容客户端可以从同一 tag 导入 `plugins/figma-local-agent`。Agent Plugin 会自动配置匹配版本的 stdio MCP Server。

### 2. 导入 Figma 插件

从匹配的 [v0.9.0 GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v0.9.0) 下载 `figma-agent-bridge-plugin-v0.9.0.zip`，解压到不会被移动或删除的目录。

在 **Figma Desktop → Plugins → Development → Import plugin from manifest** 中选择：

```text
figma-agent-bridge-plugin/manifest.json
```

### 3. 完成首次配对

在 Figma 中启动 **Local Figma Agent Bridge** 并保持插件窗口打开，然后在 PowerShell 运行：

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

核对 PowerShell 与插件显示的六位短码，只有完全一致时才点击 **Codes match**。配对成功后插件会自动重连。

### 4. 验证连接

重启 MCP 客户端或新建 Agent 会话，然后让 Agent 调用 `figma_status`。正常结果会包含当前 Figma 文档、页面、选择和 Bridge 能力。

Development build 与源码构建的安装方式见[完整安装与配置](docs/zh-CN/configuration.md)。Development 插件不能与稳定版 MCP 包混用，反之亦然。

## 配置 MCP 客户端

### 推荐：由 Agent Plugin 自动配置

安装 `figma-local-agent` Agent Plugin 后无需再手写 MCP 配置。其 `mcp.json` 会启动：

```text
npx.cmd -y figma-local-agent-mcp@0.9.0 serve
```

### 手动配置 fallback

仅在客户端不支持 Agent Plugins 1.0 时手动添加 stdio Server。Windows GUI 应用必须优先使用 `npx.cmd`，而不是 `npx`。

Codex 项目级 `.codex/config.toml`：

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Claude Code、Claude Desktop、Cursor 或其他标准 stdio MCP 客户端：

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

保存后重启 MCP 客户端。更多客户端示例见[Windows MCP 主机配置](docs/zh-CN/hosts.md)。

### 配置自检

```powershell
npx -y figma-local-agent-mcp@0.9.0 doctor
```

自检完成后确认：

1. Figma 已打开一个 Design 文件。
2. **Local Figma Agent Bridge** 正在运行且窗口保持开启。
3. MCP 客户端能发现 `figma_status`。
4. `figma_status` 能返回当前文档、页面和选择。

## 快速使用

1. 在 Figma Desktop 打开目标 Design 文件和 **Local Figma Agent Bridge**。
2. 在 Agent 中先检查 `figma_status`。
3. 在 Figma 中选择需要处理的节点，向 Agent 描述读取或修改目标。
4. 修改任务会产生隔离的 Proposal；在 Figma 中审查副本，不会覆盖源稿。

可以直接向 Agent 提出类似请求：

- **读取设计**：“读取当前选择，说明它的层级、Auto Layout、字体和视觉样式，不要修改 Figma。”
- **修改设计**：“把当前卡片复制为 Proposal，调整间距和标题，然后渲染修改结果供我审查。”
- **生成设计**：“使用 DesignPlan 创建一个新的登录页 Proposal，先验证完整计划，再应用并渲染预览。”

## MCP 工具列表

服务器暴露固定集合的 23 个 MCP 工具。“Figma 写入”表示是否会修改当前 Figma 文档；读取、导出和内存素材暂存不会改动文档。

### 状态

| 工具           | 用途                                     | Figma 写入 |
| -------------- | ---------------------------------------- | ---------- |
| `figma_status` | 返回插件连接、当前文档、页面、选择和能力 | 否         |

### 读取与发现

| 工具                         | 用途                                                  | Figma 写入 |
| ---------------------------- | ----------------------------------------------------- | ---------- |
| `figma_get_design_resources` | 分页读取本地样式、变量及当前页可复用组件和 Instance   | 否         |
| `figma_list_fonts`           | 分页读取 Figma 当前可用字体和可变字体轴               | 否         |
| `figma_get_raw_node`         | 读取有大小限制的 `JSON_REST_V1`，用于调试未归一化细节 | 否         |
| `figma_get_variables`        | 分页读取本地变量及变量集合                            | 否         |
| `figma_get_css`              | 返回 Figma Inspect CSS 代码生成提示                   | 否         |
| `figma_get_selection`        | 返回当前页选中节点的浅层摘要                          | 否         |
| `figma_get_node`             | 返回单个节点的归一化快照和直接子节点摘要              | 否         |
| `figma_get_tree`             | 返回受深度、节点数和文本长度限制的归一化子树          | 否         |
| `figma_get_fingerprint`      | 计算有序节点完整子树的聚合指纹                        | 否         |

### 渲染与素材

| 工具                 | 用途                                                   | Figma 写入     |
| -------------------- | ------------------------------------------------------ | -------------- |
| `figma_render_node`  | 把节点渲染为受尺寸限制的 PNG，便于视觉检查             | 否             |
| `figma_export_asset` | 把节点导出为临时 PNG 或 SVG，并返回本地路径和 SHA-256  | 否             |
| `figma_stage_asset`  | 校验并把 Agent 提供的 Base64 位图或 SVG 暂存到插件内存 | 否，仅内存暂存 |

### Proposal 操作

| 工具                               | 用途                                                  | Figma 写入        |
| ---------------------------------- | ----------------------------------------------------- | ----------------- |
| `figma_duplicate_as_proposal`      | 复制编辑目标和必要上下文，创建隔离 Proposal           | 是，仅新建副本    |
| `figma_create_frame`               | 在 Proposal 中创建普通 Frame                          | 是，仅 Proposal   |
| `figma_reparent_nodes`             | 在同一 Proposal 内移动节点并设置流式或绝对定位        | 是，仅 Proposal   |
| `figma_set_layout`                 | 设置 Proposal 节点的 Auto Layout、间距、尺寸和定位    | 是，仅 Proposal   |
| `figma_create_component_from_node` | 把 Proposal 内的 Frame 转换为 Component               | 是，仅 Proposal   |
| `figma_set_instance_properties`    | 修改 Proposal 内 Instance 的公开属性，不分离 Instance | 是，仅 Proposal   |
| `figma_update_text`                | 在预加载字体后原子更新 Proposal 文本                  | 是，仅 Proposal   |
| `figma_discard_proposal`           | 在指纹未变化时删除 Bridge 创建的 Proposal             | 是，删除 Proposal |

### DesignPlan

| 工具                         | 用途                                                     | Figma 写入          |
| ---------------------------- | -------------------------------------------------------- | ------------------- |
| `figma_validate_design_plan` | 只读验证完整声明式 DesignPlan，返回五分钟内单次有效的 ID | 否                  |
| `figma_apply_design_plan`    | 使用有效验证 ID 原子创建完整 Proposal                    | 是，仅新建 Proposal |

`figma_get_fingerprint` 返回完整子树的有序聚合指纹，用于 DesignPlan 的 `source.fingerprint`、Proposal 乐观并发检查和安全丢弃。`figma_get_node`、`figma_get_tree` 等有界读取返回的快照指纹覆盖范围不同，不能替代聚合指纹。连续修改 Proposal 时，应把每次写操作返回的新指纹传给下一次操作的 `expectedFingerprint`。

## 安全边界与限制

- **源稿不可变**：公开写工具只能创建 Proposal，或操作带 Bridge 标记的 Proposal 根内部节点。
- **并发保护**：Proposal 修改和丢弃支持完整树指纹校验，检测到用户编辑后不会盲目覆盖或删除。
- **本地认证**：WebSocket 只绑定 `127.0.0.1`；六位短码用于确认首次配对，后续请求使用设备凭据和新鲜 proof。
- **素材限制**：输入只接受 Base64，不抓取 URL，也不读取调用方提供的本地路径。位图限制为 8 MiB/4096 px，SVG 限制为 2 MiB/16384 单位。
- **临时文件**：导出内容写入 `%TEMP%/figma-agent-mcp/<session>/`，会话结束时删除，并清理超过 24 小时的遗留会话。
- **有限日志**：Daemon 日志不记录密钥、图像 Base64 或原始节点 JSON，并只保留一个轮转文件。
- **Team Library**：不会查询 Team Library。若需要复用团队组件，必须先把对应 Instance 放到当前页面。
- **运行范围**：只支持本机环境和一个活动 Figma 插件窗口；纯远程 Agent 无法访问 Bridge。

完整边界见[架构与安全模型](docs/zh-CN/architecture.md)、[安全说明](docs/zh-CN/security.md)和[验收运行手册](docs/zh-CN/acceptance.md)。

## 更新、恢复与故障排查

### 更新与设备管理

- 更新时同时替换 Figma 插件 ZIP 和 MCP npm 包版本，不能混用不同版本。
- `npx -y figma-local-agent-mcp@0.9.0 doctor`：检查本地服务，不输出凭据。
- `npx -y figma-local-agent-mcp@0.9.0 devices list`：查看已配对设备。
- `npx -y figma-local-agent-mcp@0.9.0 devices revoke <deviceId>`：撤销指定设备。
- `npx -y figma-local-agent-mcp@0.9.0 devices revoke --all`：撤销全部设备；插件需要重新配对。

从 v0.1 升级时会删除旧共享密钥并要求重新配对。升级前先关闭所有 v0.1 MCP 任务，让旧 Daemon 释放 3900 端口。

### 常见问题

| 现象                         | 处理方法                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PLUGIN_NOT_CONNECTED`       | 在 Figma Desktop 中打开 **Local Figma Agent Bridge** 并保持窗口开启；首次使用时先完成配对                                        |
| 更新后无法连接               | 确认插件 ZIP 与 MCP Server 版本完全一致，必要时重新配对并重启 MCP 客户端                                                         |
| 找不到 `npx.cmd`             | 安装 Node.js 20+，重启客户端，并在 PowerShell 运行 `where.exe npx` 检查 PATH                                                     |
| 3900 端口被占用              | 关闭旧版本 MCP 任务，再运行 `doctor` 确认 Daemon 状态                                                                            |
| Agent 看不到工具             | 确认 stdio 配置已保存，然后重启客户端或新建 Agent 会话                                                                           |
| 本地 `.tgz` 启动时被桌面打开 | Development build 应使用 `npm.cmd exec --package=file:... -- figma-local-agent-mcp serve`，不要把 `.tgz` 直接作为 `npx` 位置参数 |

更完整的安装、Development build 和源码恢复步骤见[安装与配置](docs/zh-CN/configuration.md)。

## 项目结构与开发

```text
figma_bridge_agent/
├── apps/
│   ├── figma-plugin/          # Figma UI、主进程、读取与 Proposal 执行
│   └── mcp-server/            # CLI、stdio MCP Adapter、Daemon 与安全边界
├── packages/
│   ├── protocol/              # 服务端与插件共享的 Zod 协议和类型
│   └── test-support/          # 跨包测试辅助工具
├── plugins/
│   └── figma-local-agent/     # 可移植 Agent Plugin、MCP 配置和工作流 Skill
├── docs/
│   ├── zh-CN/                 # 中文架构、配置、安全、验收与发布文档
│   └── en-US/                 # 对应英文文档
└── scripts/                   # 发布产物生成与校验脚本
```

贡献者需要 Node.js 20+ 和 pnpm 11：

```powershell
pnpm install
pnpm check
pnpm build:release
```

`pnpm check` 执行 Agent Plugin 校验、类型检查、Lint、格式检查、测试和构建。`pnpm build:release` 会在 `artifacts/` 下生成 Figma 插件 ZIP、npm tarball、可移植 Agent Plugin ZIP 和 `SHA256SUMS`。

进一步阅读：

- [安装与配置](docs/zh-CN/configuration.md)
- [架构与安全模型](docs/zh-CN/architecture.md)
- [安全说明](docs/zh-CN/security.md)
- [验收运行手册](docs/zh-CN/acceptance.md)
- [手动发布手册](docs/zh-CN/releasing.md)

Owner 应遵循手动发布手册；仅推送提交或 tag 不会自动发布正式版本。

## 版本范围

0.9 版本支持多个本地 MCP Adapter、一个活动 Figma 插件，以及当前 Design 文件的当前页面。支持读取、渲染、导出、Proposal 内受控修改和经过验证的 DesignPlan。

以下能力不在当前版本范围内：Windows 安装器、自动更新、远程传输、云同步、任意 JavaScript、源节点写入、通用删除、分离 Instance、Team Library 查询和特定框架代码生成。

## 免责声明与 License

Local Figma Agent MCP 是独立的非官方开源项目，与 Figma 不存在隶属、合作或背书关系。使用前请在自己的环境中审查生成的 Proposal 和导出内容。

本项目使用 [MIT License](LICENSE)。
