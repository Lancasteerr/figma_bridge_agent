# MCP 工具参考

[文档首页](README.md)

MCP Server 公开固定集合的 23 个工具。“Figma 写入”表示是否会改变当前 Figma 文档；读取、导出和内存素材暂存不会修改文档。

## 状态

| 工具           | 用途                                             | Figma 写入 |
| -------------- | ------------------------------------------------ | ---------- |
| `figma_status` | 返回插件连接、当前文件、页面、选区和 Bridge 能力 | 否         |

## 读取与发现

| 工具                         | 用途                                                  | Figma 写入 |
| ---------------------------- | ----------------------------------------------------- | ---------- |
| `figma_get_design_resources` | 分页读取本地样式、变量及当前页可复用组件和 Instance   | 否         |
| `figma_list_fonts`           | 分页读取 Figma 当前可用字体和可变字体轴               | 否         |
| `figma_get_raw_node`         | 读取有大小限制的 `JSON_REST_V1`，用于调试未归一化细节 | 否         |
| `figma_get_variables`        | 分页读取本地变量及变量集合                            | 否         |
| `figma_get_css`              | 返回 Figma Inspect CSS 代码生成提示                   | 否         |
| `figma_get_selection`        | 返回当前页选中节点的浅层摘要                          | 否         |
| `figma_get_node`             | 返回单个节点的规范化快照和直接子节点摘要              | 否         |
| `figma_get_tree`             | 返回受深度、节点数和文本长度限制的规范化子树          | 否         |
| `figma_get_fingerprint`      | 计算有序节点完整子树的聚合指纹                        | 否         |

## 渲染与素材

| 工具                 | 用途                                                   | Figma 写入     |
| -------------------- | ------------------------------------------------------ | -------------- |
| `figma_render_node`  | 把节点渲染为受尺寸限制的 PNG，便于视觉检查             | 否             |
| `figma_export_asset` | 把节点导出为临时 PNG 或 SVG，并返回路径和 SHA-256      | 否             |
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

DesignPlan v1 的节点结构和约束见随 Agent Plugin 分发的 [DesignPlan v1 reference](../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md)。

## 推荐调用流程

### 读取设计

1. 调用 `figma_status`，确认插件已连接并检查当前选区。
2. 使用 `figma_get_selection` 定位目标，再按需读取 node、tree、CSS、字体和设计资源。
3. 使用 `figma_render_node` 核对视觉结果；只有需要交付文件时才导出素材。

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
- 工具可发现但插件未连接时，调用会快速返回 `PLUGIN_NOT_CONNECTED`。
