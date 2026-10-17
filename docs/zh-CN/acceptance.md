# 端到端验收运行手册

[English](../en-US/acceptance.md) · [文档首页](README.md)

本手册供贡献者验证候选发行产物。手动验收前先运行 `pnpm build:release`，并用候选版本号替换本页所有 `<VERSION>`。必须从生成的 Figma ZIP、npm tarball 和 Agent Plugin ZIP 执行普通用户路径，不能直接使用 workspace 入口。修改场景请使用一次性 Figma 页面。

## 1. 分发与配对门禁

1. 在只安装 Node.js 20+ 的干净 Windows 账户中检查 `artifacts/figma-agent-bridge-plugin-v<VERSION>.zip`、`figma-local-agent-mcp-<VERSION>.tgz`、`figma-local-agent-plugin-v<VERSION>.zip`，并确认 `SHA256SUMS` 中存在三条对应记录。
2. 解压 Figma 插件 ZIP，直接导入其中的 `manifest.json`，不得编辑 ID。
3. 启动插件，确认界面中不存在密钥或 Plugin ID 输入框。
4. 运行 `npm exec --yes --package="file:./artifacts/figma-local-agent-mcp-<VERSION>.tgz" -- figma-local-agent-mcp pair`。
5. 确认两端显示相同六位短码，点击 **Codes match**，并确认 CLI 报告成功。
6. 重启 Figma 和 MCP 主机，确认无需再次配对即可自动连接。
7. 运行 `devices list`，撤销当前设备，并确认插件立即返回配对界面。
8. 运行 `pnpm check:agent-marketplaces`，确认三份源索引与生成的 Codex、Cursor、Copilot 固定入口同步。
9. npm `<VERSION>` 和 GitHub `v<VERSION>` tag 公开后，运行 `codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v<VERSION>`，通过 `/plugins` 安装 **Local Figma Agent**，新建会话，并确认无需手工配置 MCP 即可发现全部 25 个静态工具和随插件提供的 Skill。
10. 在 Copilot CLI 中运行 `copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v<VERSION>` 和 `copilot plugin install figma-local-agent@figma-bridge-marketplace`；新建会话并确认相同的静态工具和 Skill 可用。
11. 在 Cursor 团队中通过 **Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo** 导入 `https://github.com/Lancasteerr/figma_bridge_agent`；从 **Customize** 安装 **Local Figma Agent**，并确认相同的静态工具和 Skill 可用。
12. 在未安装 Agent Plugin 的干净 Claude Code 配置中，按[直接 MCP 指南](install-mcp-server.md#claude-code)注册 npm 稳定版；确认能够发现相同的静态工具，但不会自动出现 **Local Figma Agent** Skill。
13. 检查 Agent Plugin ZIP，确认其中包含 `skills/figma-local-agent/references/design-plan-v1.md`、`skills/figma-local-agent/references/asset-export.md`、`skills/figma-local-agent/references/frontend-implementation.md` 和 `skills/figma-local-agent/references/workunits.md`，但不包含任何仓库级 marketplace 文件。

如果此门禁失败，不要继续验收。

## 2. 连接和读取路径

1. 先使用已安装的 Agent Plugin 启动 Codex；再在未安装该插件的独立 Claude Code 配置中，按[直接 MCP 指南](install-mcp-server.md)重复关键连接检查。两个客户端都只能加载一个 `figma-local-agent` Server。
2. 确认工具列表恰好包含 25 个静态工具，并按 inspect、frontend、design 领域前缀命名；所有旧工具名都必须被拒绝。调用 `figma_status`；确认协议 10 已在内部通过校验，且公共结果只包含文件/页面元数据、选择摘要以及带 session ID 的 `UNBOUND` 工作区。2.9.2 插件或 Server 不得与协议 10 混用，而应明确失败。
3. 关闭插件并再次调用；确认约一秒内返回 `PLUGIN_NOT_CONNECTED`，而不是一直挂起。
4. 重新打开插件，确认能够自动重连。
5. 再打开两个 Codex 任务，确认三个任务都发现相同的 25 个静态工具，并能通过同一插件调用 `figma_status`。
6. 确认不存在 `figma_activate_workflow`，也不会因任何工具调用触发 `notifications/tools/list_changed`；每个任务始终保持相同工具集合。
7. 关闭其中一个任务，确认另两个任务仍保持连接。运行 `bridge status`，确认客户端数量变化且插件不断线。
8. 选择粗略的 ArticleCard，使用 `figma_status` 返回的选区并调用 `figma_inspect_read_node_facts`、`figma_inspect_browse_nodes` 和 `figma_inspect_render_preview`；确认旧的 selection 与 variables 工具不存在。
9. 确认 `figma_inspect_read_node_facts` 接受稳定字段组，始终返回名称/类型/父节点，只有显式请求才返回 `DIRECT_CHILDREN`，并省略默认布尔值、零旋转、空集合、无效蒙版外壳、重复渲染边界及公开来源指纹。按需读取时仍应保留 Auto Layout/Grid、尺寸约束、子项对齐、文本截断与样式、描边、独立圆角、真实渲染边界和素材事实。clipping/overflow 只能作为静态事实，不能据此声称页面、容器、吸顶或其他滚动行为已确定。
10. 调用 `figma_inspect_read_raw_fields` 时确认默认不含 `children`；`depth: 1` 只保留一层，`fields` 最多接受 32 个唯一顶层字段并始终保留 `id`、`name`、`type`，且投影发生在 256 KiB/2 MiB 字节检查之前。模拟空 image hash、找不到图片和尺寸查询异常；确认 paint 定位和错误状态保留，整次节点读取仍成功。修改布局、文本、形状、图片、裁剪、矢量、蒙版或导出设置事实，确认新 Workunit 来源得到不同 `sourceFingerprint`，而节点事实读取仍不公开指纹。

## 3. 基础 Proposal 路径

1. 创建一个至少包含三张卡片的 Auto Layout 列表，记录列表和卡片的指纹、层级、几何、锁定状态和截图。
2. 调用 `figma_design_duplicate_as_proposal`，把中间卡片放入 `editTargetNodeIds`。确认结果以 `AUTO_LAYOUT_PARENT` 解析到列表、返回目标卡片映射，并把 Proposal 放为 Page 子节点而不是源列表内部。
3. 确认源列表和所有卡片的指纹、顺序、几何、可见性和锁定状态不变；确认 Proposal 副本已递归解锁。
4. 同时修改请求卡片和复制进来的兄弟/上下文节点；确认二者都成功，因为整个 Proposal 可写。使用原卡片 ID 写入时应返回 `NODE_NOT_IN_PROPOSAL`。
5. 分别测试 Page 直属 Rectangle、绝对定位子节点、Component Set 变体、Group 内叶节点和共享同一 Auto Layout 父级的两个目标；确认非 Frame 目标仍受支持，`targetMap` 只包含请求目标及解析原因，且不返回内部复制根或完整 ID 映射。
6. 构造超过 1000 个节点的上下文；确认推导上下文退回目标并返回 `CLONE_CONTEXT_TRUNCATED`。若目标自身子树超限，确认返回 `LIMIT_EXCEEDED` 且不创建节点。
7. 在 Proposal 内创建 Content Frame，以 `FLOW` 或 `ABSOLUTE` 重挂目标子节点，并应用两到三层 Auto Layout。
8. 手动编辑 Proposal，然后使用旧指纹尝试丢弃；确认返回 `PROPOSAL_CHANGED`。对 Proposal 根调用 `figma_design_read_source_fingerprint`，再使用返回的完整树指纹丢弃整个 Proposal。
9. 确认已有 marker v2 Proposal 仍可读写；不支持的 marker 版本必须返回 `PROPOSAL_VERSION_UNSUPPORTED` 且不发生修改。

## 4. 声明式 DesignPlan 路径

1. 检查 `tools/list` 中的 `figma_design_validate_plan`；确认公开 `plan` 是紧凑的通用 JSON，不携带递归节点定义，同时仍公开 `returnRefs`。
2. 确认 Agent 从随插件提供的 DesignPlan reference 读取完整结构。分别提交合法计划和缺少必需字段的计划，确认服务端内部的完整 `DesignPlanSchema` 仍严格接受前者并拒绝后者，而不是依赖 Agent 试探 validator。
3. 构建根为 360 × 180 卡片 Proposal 的 v1 计划，包含 Auto Layout 和文本；确认该根被视为隔离技术容器，而不是 Figma Page 或完整页面。
4. 对卡片执行一次验证和应用，渲染结果，获取最新完整树指纹并丢弃；确认源稿没有变化。
5. 对于带来源的计划，使用包含非 Frame Clone 来源和可复用 Component/Instance 的有序根节点调用 `figma_design_read_source_fingerprint`；把相同 ID 顺序和返回指纹写入来源声明，并确认颠倒多个根的顺序会改变指纹。
6. 修改一个来源，然后应用已验证计划；确认返回 `PLAN_STALE`，且没有临时 Frame 残留。撤销手动源节点修改。
7. 获取新的聚合指纹，以 `returnRefs` 选择一个节点 ref 与一个资源 ref，对修订后的完整候选只验证一次并应用；确认 Proposal 先隐藏创建，再显示在源节点右侧，且 `refMap` 只包含所选 ref。再用空 `returnRefs` 验证默认不返回 `refMap`，并拒绝未知、重复和超过 200 个 ref。
8. 重复使用相同 ID；确认由于 ID 只能使用一次而返回 `VALIDATION_EXPIRED`。
9. 再以更大设计覆盖嵌套 Auto Layout、图形、固定宽度/自动高度文本、渐变、描边、圆角、效果和绝对定位覆盖层，确认覆盖层位置正确；验证恰好 1000 节点/深度 32 能通过，增加一个节点/层级后被拒绝。

## 5. Workunit 和资源路径

1. 列出字体，分别以 STRICT 和 ALLOW_FALLBACK 验证混合字体；确认只使用 Agent 显式列出的回退，缺失字体不产生半成品。
2. 暂存合法 PNG/JPEG/GIF/SVG，覆盖全部图片缩放模式，并确认公共句柄和 DesignPlan 引用只使用 `assetId`（暂存结果另可包含尺寸与过期时间）；拒绝伪造 MIME、损坏/超限文件、恶意 SVG、过期 ID 和缺失素材，同时确认内部摘要校验与去重仍有效。
3. 调用 `figma_inspect_read_design_resources`，确认本地样式/变量和当前页 Component/Component Set/Instance 分页返回；不得出现其他页面或 Team Library 项。
4. 创建 Paint/Text/Effect/Grid 样式和单模式 COLOR/FLOAT/STRING/BOOLEAN 变量；确认 `Agent/<Proposal>/...` 命名、同结构复用、不同结构冲突、绑定，以及合并后的 `refMap` 只包含请求的资源 ref。
5. 从当前页 Component 创建 Instance，并克隆已经放到当前页的外部 Instance；设置暴露的文本/布尔/变体/instance-swap 值，拒绝非当前页来源，且绝不 detach。
6. 强制中途异常并确认节点/资源清理；模拟 `BUILDING` 标记并确认下一次写操作恢复；丢弃成功 Proposal 后确认已提交资源仍保留。
7. 在 Plan 模式探查裁剪头像、背景图、多 Image Fill、图片描边、多 Vector Logo、蒙版和混合效果；记录实现决策、paint 位置、格式与相对路径，并确认工程没有新增文件，也没有组装逐项 fingerprint 链。
8. 对大型根调用 `figma_frontend_index_scope`，确认只写入结构索引。对有界根调用 `figma_frontend_prepare_workunit`，确认生成稳定 `workUnitId`、不可变来源修订、`source/current.json` 和一次性创建的 `implementation.json`；重复准备及来源刷新不得改写 implementation 文件字节。
9. 启动 Agent Plugin 后先调用 `figma_status`，确认初始状态为独立的 `UNBOUND` 会话且不存在暂存导出目录。由 Agent 在自身任务执行环境取得准确的绝对 cwd，并使用最新 `workspace.sessionId` 调用 `figma_frontend_bind_workspace`；确认状态切换到真实项目的 `BOUND`。用 `workUnitId` 导出头像/背景 RAW item 和渲染 SVG；确认 PNG/JPEG/GIF/WebP 按魔数追加扩展名且不合成裁剪/滤镜或转码，SVG 拒绝 scale，渲染扩展名必须匹配，结果包含 MIME、最终文件固有尺寸及 `PIXEL`/`FIGMA_UNIT`。对 SVG fixture 确认源节点 `18.75 × 17.835`、最终画布 `23 × 22` 时返回 `23 × 22`；覆盖数值属性、`px` 属性和 `viewBox` 回退。无有效 SVG 尺寸时应返回结构化格式错误并使整批保持原子性。`figma_inspect_render_preview` 的像素尺寸也必须与最终 PNG 字节一致。
10. 在新的未绑定 MCP Adapter 中确认 `figma_status` 返回独立 `UNBOUND` session。使用错误 session ID、相对路径、文件系统根、用户主目录和插件目录绑定时应分别得到稳定错误；同根重复绑定应幂等成功，改绑应返回 `EXPORT_ROOT_CONFLICT`。保持未绑定并确认素材、索引和 Workunit 写入返回 `EXPORT_ROOT_UNBOUND`，同时临时存储中的树 artifact 与渲染仍可用。
11. 修改 Figma 图片 hash、裁剪参数或 Logo 子节点，再用旧来源对应的 `workUnitId` 导出；确认陈旧 implementation 被拒绝且不产生文件。根外节点也必须失败且不写入。
12. 重复导出相同内容，确认返回 `REUSED`。修改本地目标后用默认策略导出，确认返回 `EXPORT_TARGET_CONFLICT` 且现有文件不变。
13. 检查现有文件 SHA-256 后显式传入 `OVERWRITE` 和该摘要，确认返回 `UPDATED`；错误或过期摘要必须拒绝。解析后路径重复、目标冲突或批次中途失败必须回滚整个批次，不留下部分目标、备份或暂存文件。
14. 尝试绝对路径、盘符、UNC、`..`、NUL、symlink/junction 越界、目录和其他非普通目标；全部应在写入前拒绝。确认公开 MCP 结果不含 Base64 或 SVG 正文。
15. 拒绝 33 项素材批次和解码后超过 64 MiB 的暂存内容；确认成功或失败后瞬时会话暂存目录均被清理。让临时树/渲染 artifact 过期并确认其独立 TTL/配额行为不回退。

## 6. Codex 自然语言场景

使用以下验收提示词：

> 先调用 `figma_status`。检查选中的粗略 ArticleCard 和参考网页。读取有界树、渲染、字体及当前页设计资源；构建 DesignPlan 前先读取随插件提供的 DesignPlan v1 reference，再获取全部来源根的有序完整树指纹；把所需图片/SVG 以 Base64 提供，构建一个完整候选且不查询 Team Library，只验证一次并应用为隔离 Proposal，然后重新读取并渲染结果。遇到依赖过期、素材错误、资源冲突或显式字体不可用时停止，不要绕过校验。

通过标准：源截图、指纹和层级结构保持不变；Proposal 具备预期的 Auto Layout；没有 Instance 被分离；取消或失败后不留下临时节点；插件重启后仍能识别 Proposal；实施所需素材安全落到当前 Adapter 绑定的工作区，且公开结果不含素材正文、摘要、内部路径或输入回显。

## 视觉对比

Figma 渲染器的输出可能因版本而异。保留前后 PNG 供人工审查，并检查几何数据；不要要求跨版本的像素完全一致。
