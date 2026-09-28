# 端到端验收运行手册

[English](acceptance.md)

手动验收前先运行 `pnpm build:release`。必须从生成的 ZIP 和 npm tarball 执行普通用户路径，不能直接使用 workspace 入口。修改场景请使用一次性 Figma 页面。

## 1. 分发与配对门禁

1. 在只安装 Node.js 20+ 的干净 Windows 账户中解压 `artifacts/figma-agent-bridge-plugin-v0.2.0.zip`，直接导入其中的 `manifest.json`，不得编辑 ID。
2. 启动插件，确认界面中不存在密钥或 Plugin ID 输入框。
3. 运行 `npx -y ./artifacts/figma-local-agent-mcp-0.2.0.tgz pair`。
4. 确认两端显示相同六位短码，点击 **Codes match**，并确认 CLI 报告成功。
5. 重启 Figma 和 MCP 主机，确认无需再次配对即可自动连接。
6. 运行 `devices list`，撤销当前设备，并确认插件立即返回配对界面。

如果此门禁失败，不要继续验收。

## 2. 连接和读取路径

1. 使用 `docs/hosts.zh-CN.md` 中的配置启动 Codex。
2. 调用 `figma_status`；确认协议 v2 已认证，并返回文件/页面元数据和选择摘要。
3. 关闭插件并再次调用；确认约一秒内返回 `PLUGIN_NOT_CONNECTED`，而不是一直挂起。
4. 重新打开插件，确认能够自动重连。
5. 再打开两个 Codex 任务，确认三个任务都发现相同的 19 个工具，并能通过同一插件调用 `figma_status`。
6. 关闭其中一个任务，确认另两个任务仍保持连接。运行 `bridge status`，确认客户端数量变化且插件不断线。
7. 选择粗略的 ArticleCard，并调用 selection、node、tree 和 render 工具。
8. 确认规范化树和图像足以识别行/列关系以及覆盖层。

## 3. 基础 Proposal 路径

1. 记录源根节点指纹、层级结构和截图。
2. 使用 `figma_duplicate_as_proposal` 复制它。
3. 在 Proposal 内创建 Content Frame。
4. 重新挂载目标子节点，在 Auto Layout 下明确选择 `FLOW` 或 `ABSOLUTE`。
5. 使用 `figma_set_layout` 应用两到三层 Auto Layout。
6. 重新读取源节点和 Proposal。确认源指纹未改变，且重要子节点的几何偏移不超过 1 px。
7. 手动编辑 Proposal，然后使用旧指纹尝试丢弃；确认返回 `PROPOSAL_CHANGED`。
8. 读取新指纹并丢弃；确认整个 Proposal 被移除。

## 4. 声明式 LayoutPlan 路径

1. 使用当前源指纹和完整的源节点覆盖范围构建 v1 计划。
2. 对其进行验证。确认没有创建 Figma 节点，并记录五分钟有效期的 `validationId`。
3. 修改源节点，然后应用计划；确认返回 `PLAN_STALE`，且没有临时 Frame 残留。撤销手动源节点修改。
4. 再次验证并应用一次；确认完整的 Proposal 先隐藏创建，再显示在源节点右侧。
5. 重复使用相同 ID；确认由于 ID 只能使用一次而返回 `VALIDATION_EXPIRED`。
6. 确认覆盖层仍是绝对定位，并且位置正确。

## 5. 语义和资源路径

1. 更新混合字体文本。如果所需字体不可用，确认没有字符或文本范围发生改变。
2. 将 Proposal 根 Frame 转换为 Component，并确认重启插件后仍能识别其 Proposal 标记。
3. 在 Proposal 中创建或选择一个 Instance，修改其暴露的文本、布尔值或变体属性；确认它仍然是 Instance。
4. 读取 CSS，确认它被标记为提示；当变量足够多时，读取至少包含两个页面的本地变量。
5. 渲染最终 Component，并导出 PNG 和 SVG 资源。
6. 确认结果包含临时本地路径和 SHA-256，且没有文件写入当前前端仓库。

## 6. Codex 自然语言场景

使用以下验收提示词：

> 检查 Figma 中选中的粗略 ArticleCard。读取其有界树并进行渲染，解释当前结构，然后提出一个保留源节点和覆盖层的 LayoutPlan。验证并将其作为 Proposal 应用，将 Proposal 根节点转换为 Component，重新读取结果，并导出 PNG 和 SVG 资源。如果出现过期指纹或字体问题，请停止并报告，不要绕过安全检查。

通过标准：源截图、指纹和层级结构保持不变；Proposal 具备预期的 Auto Layout；没有 Instance 被分离；取消或失败后不留下临时节点；插件重启后仍能识别 Proposal；导出的资源是临时文件并带有校验和。

## 视觉对比

Figma 渲染器的输出可能因版本而异。保留前后 PNG 供人工审查，并检查几何数据；不要要求跨版本的像素完全一致。
