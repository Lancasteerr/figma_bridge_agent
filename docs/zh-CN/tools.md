# MCP 工具参考

[English](../en-US/tools.md) · [文档首页](README.md)

MCP Server 公开固定集合的 26 个工具。“Figma 写入”表示是否会改变当前 Figma 文档；读取、导出和内存素材暂存不会修改文档。

## 状态

| 工具                     | 用途                                                              | Figma 写入 |
| ------------------------ | ----------------------------------------------------------------- | ---------- |
| `figma_status`           | 返回插件连接、当前文件、页面、选区、Bridge 能力及本会话导出根状态 | 否         |
| `figma_bind_export_root` | 将 Agent 任务执行环境的绝对 cwd 一次性绑定为本会话导出根          | 否         |

## 读取与发现

| 工具                         | 用途                                                  | Figma 写入 |
| ---------------------------- | ----------------------------------------------------- | ---------- |
| `figma_get_design_resources` | 分页读取本地样式、变量及当前页可复用组件和 Instance   | 否         |
| `figma_list_fonts`           | 分页读取 Figma 当前可用字体和可变字体轴               | 否         |
| `figma_get_raw_node`         | 读取有大小限制的 `JSON_REST_V1`，用于调试未归一化细节 | 否         |
| `figma_get_variables`        | 分页读取本地变量及变量集合                            | 否         |
| `figma_get_css`              | 返回 Figma Inspect CSS 代码生成提示                   | 否         |
| `figma_get_selection`        | 返回当前页选中节点的浅层摘要                          | 否         |
| `figma_get_node`             | 返回单个节点快照、素材事实和直接子节点摘要            | 否         |
| `figma_get_tree`             | 返回包含素材事实且受深度、节点数和文本长度限制的子树  | 否         |
| `figma_get_fingerprint`      | 计算有序节点完整子树的聚合指纹                        | 否         |

## 语义快照

| 工具                          | 用途                                                         | Figma 写入     |
| ----------------------------- | ------------------------------------------------------------ | -------------- |
| `figma_export_semantic_scope` | 把有界节点范围持久化为 outline/facts JSONL，只返回路径和摘要 | 否，写本地文件 |
| `figma_check_semantic_scope`  | 比较已存指纹和当前完整子树，返回 `FRESH` 或 `STALE`          | 否             |

## 渲染与素材

| 工具                 | 用途                                                   | Figma 写入     |
| -------------------- | ------------------------------------------------------ | -------------- |
| `figma_render_node`  | 把节点渲染为受尺寸限制的 PNG，便于视觉检查             | 否             |
| `figma_export_asset` | 提取原始 Image Paint 或渲染节点，安全写入工程/暂存根   | 否，写本地文件 |
| `figma_stage_asset`  | 校验并把 Agent 提供的 Base64 位图或 SVG 暂存到插件内存 | 否，仅内存暂存 |

## Proposal 操作

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

## DesignPlan

| 工具                         | 用途                                               | Figma 写入          |
| ---------------------------- | -------------------------------------------------- | ------------------- |
| `figma_validate_design_plan` | 只读验证完整 DesignPlan，返回五分钟内单次有效的 ID | 否                  |
| `figma_apply_design_plan`    | 使用有效验证 ID 原子创建完整 Proposal              | 是，仅新建 Proposal |

DesignPlan v1 的节点结构和约束见 [DesignPlan v1 reference](../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md)。Agent Plugin 会自动包含该 reference；直接配置 MCP Server 的用户应在构建计划前从仓库阅读它。

## 素材探查与导出

`figma_get_node` 和 `figma_get_tree` 的 `assets` 仅陈述 Figma 事实：Image Paint 的 `FILLS`/`STROKES` 位置、索引、hash、原始尺寸、缩放/裁剪、滤镜和可见性，节点导出设置、矢量路径/段数量及蒙版状态。相同 image hash 在一次树读取中只查询一次尺寸；空 hash、找不到图片或查询异常会在对应 paint 上标记，不会使整次读取失败。上述事实与素材属性都参与节点快照指纹。

`figma_export_asset` 有两个互斥模式：

- `RAW`：传入 node ID、paint slot/index、当前 image hash、当前节点快照指纹，以及不带扩展名的工程相对 `outputPathStem`。插件重新定位 paint 并校验来源，然后返回原始字节；Server 只接受 PNG、JPEG、GIF、WebP 魔数并追加真实扩展名。RAW 不应用裁剪、滤镜、蒙版或格式转换。
- `RENDERED`：先用 `figma_get_fingerprint({ nodeIds: [nodeId] })` 获取完整子树指纹，再传入匹配扩展名的工程相对 `outputPath`。PNG/JPG 支持 1–4 倍 scale，SVG 不接受 scale。任何子节点变化都会在写文件前返回 `ASSET_SOURCE_CHANGED`。

每个 MCP Adapter 启动时都为 `STAGED`，并创建保留 24 小时的独立会话目录。实施阶段第一次导出前，Agent 必须在自己的本地任务执行环境取得精确绝对 cwd，然后用最新 `sessionId` 调用 `figma_bind_export_root`。不得从插件进程、插件缓存、Git 元数据或用户文本推测工作区。绑定成功后为 `WORKSPACE`，且本会话不能切换到另一根目录。

无法获得 Agent cwd、绑定失败或选择不绑定时，会话保持 `STAGED`。`STAGED` 结果的 `requiresCopy=true`，调用方必须把 `absolutePath` 复制到 `projectRelativePath` 并核对 SHA-256；前端代码不能引用暂存绝对路径。

路径只能是相对路径，不能含盘符、UNC、绝对路径、NUL、空段或 `..`。默认 `REUSE_OR_FAIL`：同路径同内容返回 `REUSED`，不同内容返回 `EXPORT_TARGET_CONFLICT`。只有调用方已检查现有文件并同时传入其 `expectedExistingSha256` 时，才可使用 `OVERWRITE`；成功返回 `UPDATED`。公开结果不包含 Base64 或 SVG 正文。

## 会话化语义快照

`figma_export_semantic_scope` 把范围快照写入
`.figma_bridge_agent/sessions/<sessionId>/scopes/`。`OUTLINE` 只生成扁平层级概要；
`IMPLEMENTATION` 还生成布局、文本、视觉、素材和组件事实。指定 `focusNodeIds`
时，outline 仍保留有界范围，facts 只写焦点节点。文件不嵌套 `children`，也不包含图片
Base64 或 SVG 正文。

插件在序列化前后校验完整树指纹；变化时返回 `SEMANTIC_SOURCE_CHANGED`，不落盘。
语义 RPC 正文上限为 12 MiB，超限返回 `PAYLOAD_TOO_LARGE`。`manifest.json` 记录结构化截断原因、
边界节点和省略子节点数；`DEPTH_LIMIT`、`NODE_LIMIT` 或 `BYTE_LIMIT` 会使
`complete=false`。

公开结果只包含会话、路径、指纹、完整性、字节数和 SHA-256。Agent 应读取
manifest，再用 `rg` 按 node ID/name 定向查询 JSONL，不应整文件读取
`facts.jsonl`。工具只导出客观事实；拆分范围、节点到代码映射和轻量工作单元由
Agent 决定。

## 推荐调用流程

### 读取设计

1. 调用 `figma_status`，确认插件已连接并检查当前选区。
2. 使用 `figma_get_selection` 定位目标，再按需读取 node、tree、CSS、字体和设计资源。
3. 使用 `figma_render_node` 核对视觉结果；Plan 阶段只记录所需素材、来源指纹和相对路径，不调用导出工具。
4. 实施时重新读取状态与来源，在首次导出前绑定 Agent 任务 cwd，只导出计划中列出的素材，并根据 `WORKSPACE`/`STAGED` 结果完成交付和哈希复核。

### 从设计实施代码

1. 用 `figma_status` 的最新 session ID 绑定 Agent 真实 cwd，再开始任何语义或素材写入。
2. 单节点/组件直接导出目标的 `IMPLEMENTATION`；大型区域/页面先导出 `OUTLINE`，由 Agent
   根据任务和代码结构决定子范围。
3. 每次只激活一个有界详细快照，用定向行查询获取需要的节点事实，并创建不复制语义树的轻量工作单元。
4. 完成前调用 `figma_check_semantic_scope`。`STALE` 时重新导出并复核受影响决策；
   `FRESH` 只表示设计来源未变，不代替用户要求的局部或组合验证。

### 修改现有设计

1. 读取并渲染源节点，明确目标和预期结果。
2. 调用 `figma_duplicate_as_proposal` 创建隔离副本。
3. 后续写工具始终携带 Proposal 根 ID，并把每次写操作返回的新指纹作为下一次操作的 `expectedFingerprint`。
4. 重新读取和渲染 Proposal，交给用户审查。
5. 只有在完整树指纹仍匹配时，才调用 `figma_discard_proposal`。

### 从零生成设计

1. 读取字体、当前页资源和可选来源节点的完整聚合指纹。
2. 需要图片或 SVG 时，先使用 `figma_stage_asset` 暂存 Base64 内容。
3. 构建一个完整 DesignPlan，并调用 `figma_validate_design_plan` 一次。
4. 验证成功后立即调用 `figma_apply_design_plan`；验证 ID 过期或依赖变化时，重新构建完整候选。
5. 读取并渲染最终 Proposal，不要绕过校验去试探写入处理器。

## 关键边界

- `figma_get_fingerprint` 返回完整子树的有序聚合指纹，用于来源校验、Proposal 乐观并发检查和安全丢弃。
- `figma_get_node`、`figma_get_tree` 等有界快照中的指纹覆盖范围不同，不能替代聚合指纹。
- 写工具不能修改源节点，也不能跨越带 Bridge 标记的 Proposal 根。
- 输入素材不接受 URL 或本地路径；Team Library 不会被查询；Instance 不会被分离。
- 导出路径始终相对于本会话的暂存根或显式绑定根；绑定不依赖 MCP 进程 cwd，且不能在首次导出后变更。
- 工具可发现但插件未连接时，调用会快速返回 `PLUGIN_NOT_CONNECTED`。
