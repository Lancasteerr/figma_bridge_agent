# MCP 工具参考

[English](../en-US/tools.md) · [文档首页](README.md)

MCP Server 共注册 25 个工具，但每个 MCP 连接冷启动只暴露 `figma_status` 与 `figma_activate_workflow`。公共结果只保留 Agent 下一步会消费的字段；插件 RPC、缓存和磁盘 manifest 可以保留内部摘要与记账信息，但不得直接作为工具结果返回。

## 工作流激活

先调用 `figma_status`，再调用一次 `figma_activate_workflow`：查看、导航和解释设计使用 `INSPECT`，实现前端或导出项目素材使用 `FRONTEND`，创建或修改 Figma 内容使用 `DESIGN`。SDK 通过标准 `notifications/tools/list_changed` 刷新列表；客户端必须支持该通知。

激活状态只属于当前连接。重复激活同一工作流幂等；切换工作流会禁用上一组专用工具。冷启动、`INSPECT`、`FRONTEND`、`DESIGN` 分别可见 2、9、13、21 个工具。没有 `FULL` 模式；混合任务按阶段重新激活。激活本身不连接 Figma、不绑定工作区，也不修改文件或 Proposal。

## 工具列表

| 工作流   | 分组       | 工具                               | 用途                                         | Figma 写入          |
| -------- | ---------- | ---------------------------------- | -------------------------------------------- | ------------------- |
| 始终     | 状态       | `figma_status`                     | 返回 `{document,page,selection,workspace}`   | 否                  |
| 始终     | 状态       | `figma_activate_workflow`          | 切换当前连接可见的专用工具                   | 否                  |
| FRONTEND | 状态       | `figma_bind_export_root`           | 将 Agent 任务的绝对工作区根绑定到当前会话    | 否                  |
| 全部     | 读取       | `figma_get_design_resources`       | 分页读取本地样式、变量及当前页组件/Instance  | 否                  |
| 全部     | 读取       | `figma_list_fonts`                 | 按字体族分页读取样式与可变轴                 | 否                  |
| 全部     | 读取       | `figma_get_raw_node`               | 返回自节点优先、可投影的 `JSON_REST_V1` 对象 | 否                  |
| 全部     | 读取       | `figma_get_css`                    | 返回 Figma Inspect CSS 属性映射              | 否                  |
| 全部     | 读取       | `figma_get_node`                   | 返回可投影、紧凑的单节点设计事实             | 否                  |
| 全部     | 读取       | `figma_get_tree`                   | 返回轻量导航树、截断信息或临时 JSONL         | 否                  |
| DESIGN   | 读取       | `figma_get_fingerprint`            | 返回完整有序子树的 `treeFingerprint`         | 否                  |
| FRONTEND | 语义       | `figma_export_semantic_scope`      | 写入有界范围并返回 manifest 相对路径         | 否，写本地文件      |
| FRONTEND | 语义       | `figma_check_semantic_scope`       | 返回 `FRESH` 或 `STALE`                      | 否                  |
| 全部     | 素材       | `figma_render_node`                | 生成 30 分钟有效的临时 PNG                   | 否                  |
| FRONTEND | 素材       | `figma_export_assets`              | 原子批量写入 Image Paint 或节点渲染          | 否，写本地文件      |
| DESIGN   | 素材       | `figma_stage_asset`                | 校验 Base64 位图/SVG 并暂存在插件内存        | 否，仅内存          |
| DESIGN   | Proposal   | `figma_duplicate_as_proposal`      | 复制目标及上下文并创建隔离 Proposal          | 是，仅副本          |
| DESIGN   | Proposal   | `figma_create_frame`               | 在 Proposal 中创建 Frame                     | 是，仅 Proposal     |
| DESIGN   | Proposal   | `figma_reparent_nodes`             | 在同一 Proposal 内移动节点                   | 是，仅 Proposal     |
| DESIGN   | Proposal   | `figma_set_layout`                 | 写入 Auto Layout、尺寸与定位                 | 是，仅 Proposal     |
| DESIGN   | Proposal   | `figma_create_component_from_node` | 把 Proposal 内 Frame 转为 Component          | 是，仅 Proposal     |
| DESIGN   | Proposal   | `figma_set_instance_properties`    | 修改 Instance 公开属性，不 detach            | 是，仅 Proposal     |
| DESIGN   | Proposal   | `figma_update_text`                | 预加载字体后原子更新文本                     | 是，仅 Proposal     |
| DESIGN   | Proposal   | `figma_discard_proposal`           | 指纹匹配时删除 Bridge Proposal               | 是，删除 Proposal   |
| DESIGN   | DesignPlan | `figma_validate_design_plan`       | 只读验证完整计划，生成五分钟单次 ID          | 否                  |
| DESIGN   | DesignPlan | `figma_apply_design_plan`          | 使用验证 ID 原子创建完整 Proposal            | 是，仅新建 Proposal |

`figma_get_selection` 与 `figma_get_variables` 已删除：选区由 `figma_status` 返回，变量统一由 `figma_get_design_resources` 返回。

## 工作区与文件边界

每个 Adapter 会话初始为：

```json
{ "state": "UNBOUND", "sessionId": "..." }
```

在第一次素材或语义快照写入前，Agent 必须从自己的任务执行环境取得准确绝对工作区路径，并使用当前 `sessionId` 调用 `figma_bind_export_root`。成功后状态为 `{state:"BOUND",sessionId,rootPath}`。同一规范根重复绑定幂等；切换到另一根返回 `EXPORT_ROOT_CONFLICT`。

未绑定时，`figma_export_assets` 和 `figma_export_semantic_scope` 返回 `EXPORT_ROOT_UNBOUND`，不会创建暂存文件，也不会请求插件生成大型正文。`figma_get_tree` 的临时 JSONL 与 `figma_render_node` 的临时 PNG 使用独立临时存储，因此在 UNBOUND 状态仍可使用。

导出路径必须相对工作区，不能含盘符、UNC/绝对根、NUL、空段或 `..`。默认 `REUSE_OR_FAIL`：相同内容返回 `REUSED`，不同内容返回 `EXPORT_TARGET_CONFLICT`。仅当 Agent 已本地读取现有文件并计算摘要后，才可用 `OVERWRITE` 并传入 `expectedExistingSha256`；冲突错误和成功结果都不会回传内部 SHA。

## 读取与临时结果

- `figma_get_design_resources` 返回 `{resources,nextCursor?,componentScanComplete}`；VARIABLE 可含 `codeSyntax`。
- `figma_list_fonts` 返回 `{families:[{name,styles,variationAxes?}],nextCursor?}`，游标按字体族推进。
- `figma_get_raw_node` 返回 `{node}` JSON 对象。默认 `depth: 0` 并删除 `children`；`depth: 1` 只保留一层。可用 `fields` 投影最多 32 个唯一顶层字段，`id`、`name`、`type` 始终保留，未知字段被忽略，`children` 只能由 `depth` 控制。投影和深度裁剪先于 256 KiB 默认/2 MiB 硬限制的字节检查；超限时应缩小字段或深度。`figma_get_css` 返回 `{properties}`。
- `figma_get_node` 的 `fields` 可选择 `GEOMETRY|LAYOUT|TEXT|VISUAL|ASSETS|COMPONENT|CHILDREN`。名称、类型和父节点始终返回；默认选择除 `CHILDREN` 外的字段，直接子节点必须显式请求。父级布局使用 `geometry.local`，Figma Page 定位使用 `geometry.absolute`，外描边、阴影和可见墨迹检查使用 `absoluteRenderBounds`。结果不公开 snapshot fingerprint；Figma clipping/overflow 只表示静态布局事实。
- `figma_get_tree` 返回 `{root,truncation?,artifact?}`。节点只含本地 `bounds` 与非默认提示；artifact 只含 `{localPath,expiresAt}`。
- `figma_render_node` 返回 `{localPath,width,height,expiresAt}`；宽高从最终 PNG 字节读取真实像素尺寸。

临时树文件是导航产物，不是持久语义快照。不要把整份 JSONL 放入上下文；按节点 ID、名称或类型定向查询。临时文件过期后重新读取。

## 素材探查与导出

`figma_get_node.assets` 提供 Image Paint 的 slot/index/hash、原始尺寸、缩放/裁剪、滤镜和可见性，以及导出设置、矢量与蒙版事实。`figma_get_tree.assetHints` 只用于发现候选，不能替代定向节点读取。

`figma_export_assets` 一批接受 1–32 个 item，解析后的目标路径必须唯一，总暂存数据不得超过 64 MiB。所有来源、格式、路径和覆盖条件通过后才原子提交；任一项失败时只返回一个结构化错误，项目文件不发生部分更新。item 有两个互斥模式：

- `RAW`：传入 paint slot/index 和不带扩展名的相对 `outputPathStem`。Server 按魔数识别 PNG/JPEG/GIF/WebP 并追加扩展名。
- `RENDERED`：传入匹配扩展名的相对 `outputPath`。PNG/JPG 支持 1–4 倍 scale，SVG 不接受 scale。

来源来自语义快照时，可在批次上传一次 `sourceGuard:{rootNodeId,expectedSourceFingerprint}`；所有 item 必须在根内，整批导出前后必须匹配同一来源指纹。无 guard 时插件仍逐项执行导出前后来源一致性校验。不再传入 image hash、节点 fingerprint 或逐项 tree fingerprint。

成功返回 `{assets:[{path,status,mimeType,width,height,dimensionUnit}]}`，其中 status 为 `CREATED|REUSED|UPDATED`。RAW 和渲染位图从最终字节读取真实像素尺寸；SVG 使用根元素宽高，缺失时回退到 `viewBox`，单位为 `FIGMA_UNIT`。无法取得有效固有尺寸时整批拒绝且不写文件。源节点逻辑尺寸仍由 `figma_get_node` 提供，不能用 SVG 内部路径尺寸再次缩放已导出文件。

`figma_stage_asset` 返回 `{assetId,width?,height?,expiresAt}`。DesignPlan 中 IMAGE/SVG 的 `asset` 只携带 `assetId`；SHA 仅用于插件内部去重和完整性校验。

各类 fingerprint 的职责保持收敛：前端语义快照和素材链路只复用一次 `sourceFingerprint`；`treeFingerprint` 仅用于 DesignPlan 来源及 Proposal 完整树检查；Proposal 修改继续串联 `proposalFingerprint`。`figma_get_node` 不公开 fingerprint。

## 语义快照

`figma_export_semantic_scope` 把快照写入 `.figma_bridge_agent/sessions/<sessionId>/scopes/`，并返回 `{manifestPath,sourceFingerprint,complete,truncation?}`。`manifestPath` 是工作区相对路径。磁盘 manifest 保留文件 SHA 与创建时间，公共结果不返回这些内部字段。

manifest 使用 `schemaVersion: 2`、`normalization: "COMPACT_V1"` 和 `factsStatus`。`OUTLINE` 只生成层级概要，标记 `factsStatus: "NOT_REQUESTED"`，且不创建空 `facts.jsonl`；`IMPLEMENTATION` 标记 `WRITTEN` 并生成紧凑的布局、文本、视觉、素材和组件事实。先读 manifest，再用 `rg` 按 node ID/name 查询 JSONL。`figma_check_semantic_scope` 只返回 `{status}`。

## Proposal 与 DesignPlan 返回链

- duplicate 返回 `{proposalRootId,targetMap,warnings?,proposalFingerprint}`；`targetMap` 只覆盖请求的编辑目标。
- create frame 返回 `{nodeId,proposalFingerprint}`。
- reparent、layout、Instance 属性和文本更新只返回 `{proposalFingerprint}`。
- component conversion 返回 `{componentId,newProposalRootId?,proposalFingerprint}`；仅替换根时出现新根 ID。
- discard 成功返回 `{}`。

每次 Proposal 写入后，把新的 `proposalFingerprint` 用作下一次调用的 `expectedFingerprint`。

`figma_validate_design_plan` 的公开 `plan` Schema 是紧凑的通用 JSON，避免把完整递归结构注入工具列表；服务端接收后仍用完整 `DesignPlanSchema` 严格解析。`returnRefs` 位于请求外层，不参与 plan digest，最多包含 200 个不重复的节点或资源 ref。未知 ref 会得到 `INVALID + issues`；apply 默认返回 `{proposalRootId,proposalFingerprint}`，只有验证时请求了 `returnRefs` 才增加 `refMap`。

完整 DesignPlan v1 结构见 [DesignPlan v1 reference](../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md)。

## 推荐流程

### 读取或实施设计

1. 调用 `figma_status`，再激活 `FRONTEND`；仅查看或解释设计时激活 `INSPECT`。
2. 从 selection 确认目标，用浅层 tree 导航，再按需读取 node、CSS、字体和设计资源；必要时 render。
3. 若要持久化语义或素材，先绑定 Agent 的真实工作区。
4. 实施前刷新来源事实和用途明确的指纹；完成前再次 render，并按任务要求验证实现。

### 修改现有设计

1. 调用 `figma_status`，激活 `DESIGN`，再读取并渲染源目标。
2. duplicate 为 Proposal，只使用返回的 proposal ID 与请求目标映射。
3. 串联每次写入返回的 `proposalFingerprint`。
4. 重新读取/渲染 Proposal 供用户审查。

### 从零生成设计

1. 调用 `figma_status`，激活 `DESIGN`，按需读取字体、设计资源与来源 `treeFingerprint`。
2. 图片/SVG 先 stage，并在计划中只引用 `assetId`。
3. 一次提交完整计划；仅把 apply 后确实需要的 ref 放入 `returnRefs`。
4. VALID 后立即 apply；验证 ID 过期、已消费或依赖变化时重新验证完整候选。
