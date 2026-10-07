# Local Figma Agent 文档

[English](../en-US/README.md) · [项目首页](../../README.md)

这里的文档面向 Local Figma Agent 的使用者、集成者和贡献者。若只想完成首次安装，请从[安装与配置](configuration.md)开始。

## 使用者

- [安装与配置](configuration.md)：选择稳定版、Development build 或源码构建，完成配对并排查常见问题。
- [Windows MCP 主机配置](hosts.md)：在 Codex、Claude、ChatGPT Desktop、Cursor 等主机中手动配置 stdio Server。
- [MCP 工具参考](tools.md)：了解 23 个公开工具、读写边界和推荐调用流程。
- [安全说明](security.md)：了解凭据、网络、素材、Proposal 和临时文件的安全边界。

## 开发者与贡献者

- [架构与安全模型](architecture.md)：进程关系、认证、Proposal、DesignPlan、资源和读取上限。
- [开发指南](development.md)：Monorepo 结构、开发命令、测试策略和发行产物。
- [端到端验收](acceptance.md)：从真实发行包执行配对、读取、Proposal、DesignPlan 和资源场景。

## 阅读建议

- 首次使用：安装与配置 → MCP 工具参考 → 安全说明。
- 集成新的 MCP 主机：主机配置 → 架构与安全模型。
- 修改代码：开发指南 → 架构与安全模型 → 端到端验收。
