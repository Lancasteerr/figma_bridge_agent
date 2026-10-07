# 选择安装方式

[English](../en-US/configuration.md) · [文档首页](README.md)

Local Figma Agent 有两种正式安装方式。两种方式连接的是同一个本地 stdio MCP Server，公开相同的 23 个工具，也都需要导入匹配版本的 Figma 开发插件并完成一次配对。区别只在 MCP 主机如何获得 Server 配置和工作流说明。

| 安装方式                                     | 适用客户端                                       | MCP 配置     | 工作流 Skill | 支持的发行渠道                      |
| -------------------------------------------- | ------------------------------------------------ | ------------ | ------------ | ----------------------------------- |
| [安装 Agent Plugin](install-plugin.md)       | 当前已适配 Codex、Cursor、GitHub Copilot         | 插件自动提供 | 自动包含     | 稳定版                              |
| [直接配置 MCP Server](install-mcp-server.md) | Claude Code、Claude Desktop及其他本地 stdio 主机 | 用户手工添加 | 不会自动安装 | 稳定版、Development build、源码构建 |

## 如何选择

- 客户端兼容本项目现有 Agent Plugin 入口时，优先使用[安装 Agent Plugin](install-plugin.md)。插件同时提供固定版本的 MCP 启动配置和安全 Proposal 工作流 Skill，不要再手工注册同名 MCP Server。
- 客户端没有本项目适配的插件入口，或者你希望明确控制启动命令时，使用[直接配置 MCP Server](install-mcp-server.md)。Claude Code 自身具有插件机制，但本项目当前未提供对应 marketplace 入口，因此本文档推荐直接添加 stdio Server。
- Development build 和源码构建是高级测试路径，只通过直接 MCP 指南说明；滚动 Development Release 当前不发布 Agent Plugin。

## 共同要求

- Windows
- Node.js 20 或更高版本
- Figma Desktop
- 能在本机启动 stdio MCP Server 的客户端

Figma 插件、MCP npm 包和 Agent Plugin 必须来自同一个版本或同一次构建。ChatGPT Web、Codex Cloud 等纯远程环境无法访问本机 loopback Bridge。

安装完成后可查看 [MCP 工具参考](tools.md)和[安全说明](security.md)。准备修改源码时请阅读[开发指南](development.md)。
