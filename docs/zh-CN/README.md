# Local Figma Agent 文档

[English](../en-US/README.md) · [项目首页](../../README.md)

这里的文档面向 Local Figma Agent 的使用者、集成者和贡献者。若只想完成首次安装，请先[选择安装方式](configuration.md)。

## 使用者

- [选择安装方式](configuration.md)：对比 Agent Plugin 与直接 MCP 两条正式路线。
- [安装 Agent Plugin](install-plugin.md)：在 Codex、Cursor 或 GitHub Copilot 中安装稳定版插件及 Skill。
- [直接配置 MCP Server](install-mcp-server.md)：在 Claude Code、Claude Desktop及其他 stdio 主机中配置稳定版、Development build 或源码构建。
- [MCP 工具参考](tools.md)：了解 23 个公开工具、读写边界和推荐调用流程。
- [安全说明](security.md)：了解凭据、网络、素材、Proposal 和临时文件的安全边界。

## 开发者与贡献者

- [架构与安全模型](architecture.md)：进程关系、认证、Proposal、DesignPlan、资源和读取上限。
- [开发指南](development.md)：Monorepo 结构、开发命令、测试策略和发行产物。
- [端到端验收](acceptance.md)：从真实发行包执行配对、读取、Proposal、DesignPlan 和资源场景。

## 阅读建议

- 首次使用：选择安装方式 → 对应安装指南 → MCP 工具参考 → 安全说明。
- 集成新的 MCP 主机：直接配置 MCP Server → 架构与安全模型。
- 修改代码：开发指南 → 架构与安全模型 → 端到端验收。
