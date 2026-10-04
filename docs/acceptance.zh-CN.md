# 端到端验收运行手册

[English](acceptance.md)

手动验收前先运行 `pnpm build:release`。必须从生成的 Figma ZIP、npm tarball 和 Agent Plugin ZIP 执行普通用户路径，不能直接使用 workspace 入口。修改场景请使用一次性 Figma 页面。

## 1. 分发与配对门禁

1. 在只安装 Node.js 20+ 的干净 Windows 账户中检查 `artifacts/figma-agent-bridge-plugin-v0.9.0.zip`、`figma-local-agent-mcp-0.9.0.tgz`、`figma-local-agent-plugin-v0.9.0.zip`，并确认 `SHA256SUMS` 中存在三条对应记录。
2. 解压 Figma 插件 ZIP，直接导入其中的 `manifest.json`，不得编辑 ID。
3. 启动插件，确认界面中不存在密钥或 Plugin ID 输入框。
4. 运行 `npm exec --yes --package="file:./artifacts/figma-local-agent-mcp-0.9.0.tgz" -- figma-local-agent-mcp pair`。
5. 确认两端显示相同六位短码，点击 **Codes match**，并确认 CLI 报告成功。
6. 重启 Figma 和 MCP 主机，确认无需再次配对即可自动连接。
7. 运行 `devices list`，撤销当前设备，并确认插件立即返回配对界面。
8. npm `0.9.0` 和 GitHub `v0.9.0` tag 公开后，将 `Lancasteerr/figma_bridge_agent` 作为固定到 `v0.9.0` 的 marketplace 添加，安装 `figma-local-agent@figma-local-agent`，新建会话，并确认无需手动配置 MCP 即可发现恰好 23 个工具。
9. 检查 Agent Plugin ZIP，确认其中包含 `skills/figma-local-agent/references/design-plan-v1.md`。

如果此门禁失败，不要继续验收。

## 2. 连接和读取路径

1. 使用已安装的 Agent Plugin 启动 Codex，并用 `docs/hosts.zh-CN.md` 的手动 fallback 额外重复一次关键连接检查。
2. 调用 `figma_status`；确认协议 v4 已认证，并返回文件/页面元数据、选择摘要，以及 `design-plan-v1`、`asset-staging-v1`、`font-catalog-v1`、`design-resources-v1` 能力。
3. 关闭插件并再次调用；确认约一秒内返回 `PLUGIN_NOT_CONNECTED`，而不是一直挂起。
4. 重新打开插件，确认能够自动重连。
5. 再打开两个 Codex 任务，确认三个任务都发现相同的 23 个工具，并能通过同一插件调用 `figma_status`。
6. 关闭其中一个任务，确认另两个任务仍保持连接。运行 `bridge status`，确认客户端数量变化且插件不断线。
7. 选择粗略的 ArticleCard，并调用 selection、node、tree 和 render 工具。
8. 确认规范化树和图像足以识别行/列关系以及覆盖层。

## 3. 基础 Proposal 路径

1. 创建一个至少包含三张卡片的 Auto Layout 列表，记录列表和卡片的指纹、层级、几何、锁定状态和截图。
2. 调用 `figma_duplicate_as_proposal`，把中间卡片放入 `editTargetNodeIds`。确认结果以 `AUTO_LAYOUT_PARENT` 解析到列表、返回目标卡片映射，并把 Proposal 放为 Page 子节点而不是源列表内部。
3. 确认源列表和所有卡片的指纹、顺序、几何、可见性和锁定状态不变；确认 Proposal 副本已递归解锁。
4. 同时修改请求卡片和复制进来的兄弟/上下文节点；确认二者都成功，因为整个 Proposal 可写。使用原卡片 ID 写入时应返回 `NODE_NOT_IN_PROPOSAL`。
5. 分别测试 Page 直属 Rectangle、绝对定位子节点、Component Set 变体、Group 内叶节点和共享同一 Auto Layout 父级的两个目标；确认非 Frame 目标仍受支持，返回的复制根和解析原因符合规则，且不会重复复制根。
6. 构造超过 1000 个节点的上下文；确认推导上下文退回目标并返回 `CLONE_CONTEXT_TRUNCATED`。若目标自身子树超限，确认返回 `LIMIT_EXCEEDED` 且不创建节点。
7. 在 Proposal 内创建 Content Frame，以 `FLOW` 或 `ABSOLUTE` 重挂目标子节点，并应用两到三层 Auto Layout。
8. 手动编辑 Proposal，然后使用旧指纹尝试丢弃；确认返回 `PROPOSAL_CHANGED`。对 Proposal 根调用 `figma_get_fingerprint`，再使用返回的完整树指纹丢弃整个 Proposal。
9. 确认已有 marker v2 Proposal 仍可读写；不支持的 marker 版本必须返回 `PROPOSAL_VERSION_UNSUPPORTED` 且不发生修改。

## 4. 声明式 DesignPlan 路径

1. 检查 `tools/list` 中的 `figma_validate_design_plan`；确认 `plan.root` 解析为 Proposal `FRAME` 定义，且其 `children` 引用了全部受支持节点类型。
2. 检查 MCP 主机提供给模型的工具声明；若递归字段被简化为 `unknown`，确认 Agent 会读取随插件提供的 DesignPlan reference，而不是试探 validator。
3. 构建根为 360 × 180 卡片 Proposal 的 v1 计划，包含 Auto Layout 和文本；确认该根被视为隔离技术容器，而不是 Figma Page 或完整页面。
4. 对卡片执行一次验证和应用，渲染结果，获取最新完整树指纹并丢弃；确认源稿没有变化。
5. 对于带来源的计划，使用包含非 Frame Clone 来源和可复用 Component/Instance 的有序根节点调用 `figma_get_fingerprint`；把相同 ID 顺序和返回指纹写入来源声明，并确认颠倒多个根的顺序会改变指纹。
6. 修改一个来源，然后应用已验证计划；确认返回 `PLAN_STALE`，且没有临时 Frame 残留。撤销手动源节点修改。
7. 获取新的聚合指纹，对修订后的完整候选只验证一次并应用；确认 Proposal 先隐藏创建，再显示在源节点右侧，且 `refMap` 覆盖每个计划节点。
8. 重复使用相同 ID；确认由于 ID 只能使用一次而返回 `VALIDATION_EXPIRED`。
9. 再以更大设计覆盖嵌套 Auto Layout、图形、固定宽度/自动高度文本、渐变、描边、圆角、效果和绝对定位覆盖层，确认覆盖层位置正确；验证恰好 1000 节点/深度 32 能通过，增加一个节点/层级后被拒绝。

## 5. 语义和资源路径

1. 列出字体，分别以 STRICT 和 ALLOW_FALLBACK 验证混合字体；确认只使用 Agent 显式列出的回退，缺失字体不产生半成品。
2. 暂存合法 PNG/JPEG/GIF/SVG，覆盖全部图片缩放模式并确认摘要；拒绝伪造 MIME、损坏/超限文件、恶意 SVG、过期 ID 和 SHA 不匹配。
3. 调用 `figma_get_design_resources`，确认本地样式/变量和当前页 Component/Component Set/Instance 分页返回；不得出现其他页面或 Team Library 项。
4. 创建 Paint/Text/Effect/Grid 样式和单模式 COLOR/FLOAT/STRING/BOOLEAN 变量；确认 `Agent/<Proposal>/...` 命名、同结构复用、不同结构冲突、绑定及 `resourceMap`。
5. 从当前页 Component 创建 Instance，并克隆已经放到当前页的外部 Instance；设置暴露的文本/布尔/变体/instance-swap 值，拒绝非当前页来源，且绝不 detach。
6. 强制中途异常并确认节点/资源清理；模拟 `BUILDING` 标记并确认下一次写操作恢复；丢弃成功 Proposal 后确认已提交资源仍保留。
7. 渲染最终根并导出 PNG/SVG；确认临时路径、SHA-256，且前端仓库没有新文件。

## 6. Codex 自然语言场景

使用以下验收提示词：

> 检查选中的粗略 ArticleCard 和参考网页。读取有界树、渲染、字体及当前页设计资源；构建 DesignPlan 前先读取随插件提供的 DesignPlan v1 reference，再获取全部来源根的有序完整树指纹；把所需图片/SVG 以 Base64 提供，构建一个完整候选且不查询 Team Library，只验证一次并应用为隔离 Proposal，然后重新读取并渲染结果。遇到依赖过期、素材错误、资源冲突或显式字体不可用时停止，不要绕过校验。

通过标准：源截图、指纹和层级结构保持不变；Proposal 具备预期的 Auto Layout；没有 Instance 被分离；取消或失败后不留下临时节点；插件重启后仍能识别 Proposal；导出的资源是临时文件并带有校验和。

## 视觉对比

Figma 渲染器的输出可能因版本而异。保留前后 PNG 供人工审查，并检查几何数据；不要要求跨版本的像素完全一致。
