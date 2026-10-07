# 开发指南

[文档首页](README.md)

本项目采用 pnpm Monorepo，包含本地 MCP Server、Figma 开发插件、共享协议、测试支持包和可移植 Agent Plugin。本页面向希望阅读、修改或验证源码的贡献者。

## 环境要求

- Windows
- Node.js 20 或更高版本
- pnpm 11.19.0
- Git
- Figma Desktop；只有插件交互和端到端验收需要

安装依赖：

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

## 仓库结构

```text
figma_bridge_agent/
├── apps/
│   ├── figma-plugin/          # Figma UI、主进程、读取与 Proposal 执行
│   └── mcp-server/            # CLI、stdio Adapter、Daemon 与安全边界
├── packages/
│   ├── protocol/              # Server 与插件共享的 Zod 协议和类型
│   └── test-support/          # 跨包测试辅助工具
├── plugins/
│   └── figma-local-agent/     # 可移植 Agent Plugin、MCP 配置和工作流 Skill
├── docs/                      # 中英文公开使用与开发文档
└── scripts/                   # 发行产物生成和 Agent Plugin 校验脚本
```

## 常用命令

```powershell
# 运行类型检查、Lint、格式检查、测试和构建
pnpm check

# 仅运行全部测试
pnpm test

# 构建所有 workspace package
pnpm build

# 连续构建 Figma 插件
pnpm --filter @figma-agent/figma-plugin dev

# 完整检查并生成本地发行包
pnpm build:release
```

`pnpm build:release` 会生成：

```text
artifacts/
├── figma-agent-bridge-plugin-v<VERSION>.zip
├── figma-local-agent-mcp-<VERSION>.tgz
├── figma-local-agent-plugin-v<VERSION>.zip
└── SHA256SUMS
```

`artifacts/` 和各包的 `dist/` 都是生成目录，不应提交。

## 本地联调

先运行 `pnpm build:release`。可以直接从 Figma Desktop 导入 `apps/figma-plugin/dist/manifest.json`，然后在仓库根目录配对本地 CLI：

```powershell
node .\apps\mcp-server\dist\cli.js pair
```

MCP 客户端应使用同一次构建产生的 `apps/mcp-server/dist/cli.js` 绝对路径并传入 `serve`。完整配置示例见[安装与配置](configuration.md)。不要把本地插件与不同提交或不同版本的 MCP Server 混用。

## 修改跨进程契约

Server 与 Figma 插件通过 `packages/protocol` 中的 Zod schema 共享 RPC、认证和工具数据结构。修改公开能力时应同时检查：

1. 协议 schema、导出类型和协议测试。
2. MCP Server 的工具声明、输入映射和工具契约测试。
3. Figma 插件处理器、主进程/UI 消息以及对应单元测试。
4. Agent Plugin Skill、DesignPlan reference 和中英文公开文档。

安全边界、Proposal marker 和 DesignPlan 生命周期见[架构与安全模型](architecture.md)。不要通过新增任意脚本、源稿写入或跨 Proposal 写入来绕过现有边界。

## 测试层次

- 协议测试覆盖 schema、版本和边界值。
- MCP 工具契约测试锁定公开工具名称、注解和递归输入结构。
- 插件单元测试覆盖读取、复制范围、指纹、回滚、资源和 DesignPlan。
- 脚本测试覆盖发行归档和可移植 Agent Plugin 的内容。
- [端到端验收](acceptance.md)使用真实 ZIP、tgz 和 Figma Desktop 验证普通用户路径。

提交前至少运行 `pnpm check`。涉及发行格式、插件清单、Agent Plugin 或版本字段时，还需要运行 `pnpm build:release` 并检查生成的归档。
