# MCP 工具参考

MCP Server 静态注册 27 个工具。除 `figma_status` 外，工具名通过
`figma_inspect_*`、`figma_frontend_*`、`figma_design_*` 直接表达领域；不存在工作流激活、
deprecated alias 或旧名兼容。

| 领域     | 工具                                      | 作用                                 | 写入       |
| -------- | ----------------------------------------- | ------------------------------------ | ---------- |
| 状态     | `figma_status`                            | 当前文件、页面、选区与工作区绑定状态 | 否         |
| Inspect  | `figma_inspect_browse_nodes`              | 有界轻量导航树或临时 JSONL           | 否         |
| Inspect  | `figma_inspect_read_node_facts`           | 按字段组读取单节点实施事实           | 否         |
| Inspect  | `figma_inspect_read_css_hint`             | Figma Inspect CSS 提示               | 否         |
| Inspect  | `figma_inspect_render_preview`            | 30 分钟有效的临时 PNG                | 否         |
| Inspect  | `figma_inspect_read_raw_fields`           | 有界 `JSON_REST_V1` 字段投影         | 否         |
| Inspect  | `figma_inspect_read_design_resources`     | 当前页样式、变量、组件与 Instance    | 否         |
| Inspect  | `figma_inspect_list_fonts`                | 可用字体样式和可变轴                 | 否         |
| Frontend | `figma_frontend_bind_workspace`           | 绑定 Agent 的真实绝对工作区根        | 本地状态   |
| Frontend | `figma_frontend_index_scope`              | 持久化大型范围的结构索引             | 本地文件   |
| Frontend | `figma_frontend_prepare_workunit`         | 写入不可变来源并首次创建实施骨架     | 本地文件   |
| Frontend | `figma_frontend_check_workunit_source`    | 按 `workUnitId` 返回 `FRESH/STALE`   | 否         |
| Frontend | `figma_frontend_export_assets`            | 以 workunit 来源守卫原子导出素材     | 项目文件   |
| Design   | `figma_design_read_source_fingerprint`    | 有序完整子树指纹                     | 否         |
| Design   | `figma_design_stage_asset`                | 暂存 Base64 位图或 SVG               | 插件内存   |
| Design   | `figma_design_duplicate_as_proposal`      | 创建隔离 Proposal 副本               | Figma 副本 |
| Design   | `figma_design_create_frame`               | 在 Proposal 中创建 Frame             | Figma 副本 |
| Design   | `figma_design_reparent_nodes`             | 在 Proposal 中移动节点               | Figma 副本 |
| Design   | `figma_design_set_layout`                 | 写入布局、尺寸和定位                 | Figma 副本 |
| Design   | `figma_design_update_text`                | 预加载字体后更新文本                 | Figma 副本 |
| Design   | `figma_design_set_instance_properties`    | 修改 Instance 公开属性               | Figma 副本 |
| Design   | `figma_design_create_component_from_node` | Frame 转 Component                   | Figma 副本 |
| Design   | `figma_design_discard_proposal`           | 指纹匹配时删除 Proposal              | 删除副本   |
| Design   | `figma_design_validate_plan`              | 验证完整 DesignPlan                  | 否         |
| Design   | `figma_design_apply_plan`                 | 使用一次性验证 ID 创建 Proposal      | Figma 副本 |
| Design   | `figma_design_edit_in_place`              | 显式原位编辑原稿                     | Figma 原稿 |
| Design   | `figma_design_delete_nodes`               | 按明确 ID 和范围指纹删除节点         | 删除原稿   |

## 工作区绑定

每个 Adapter 会话初始为 `UNBOUND`。前端持久写入前，Agent 必须从自己的执行环境取得准确
绝对工作区路径，用最新 `workspace.sessionId` 调用 `figma_frontend_bind_workspace`。同根重复
绑定幂等，切换根返回 `EXPORT_ROOT_CONFLICT`。未绑定时 workunit、结构索引和项目素材写入
返回 `EXPORT_ROOT_UNBOUND`；临时树和预览仍可使用。

## Inspect 事实

`figma_inspect_read_node_facts.fields` 支持
`BOUNDS|LAYOUT|TEXT|APPEARANCE|ASSET_SOURCES|COMPONENT|DIRECT_CHILDREN`。默认不含
`DIRECT_CHILDREN`。实施坐标使用 `bounds.inParent`、`bounds.onPage` 和
`bounds.renderOnPage`；导航树只返回 `navigationBoundsInParent`，不得作为实施事实。

预览返回 `{localPath,pixelWidth,pixelHeight,expiresAt}`。大树可以落到临时 JSONL，公共结果
只返回路径与到期时间。CSS 始终是提示，raw fields 只用于一个已知缺口。

## Workunit

大型页面先调用 `figma_frontend_index_scope`，它只产生结构索引并返回
`{indexManifestPath,structureComplete,truncation?}`，不回显索引来源指纹。每个实施范围必须调用
`figma_frontend_prepare_workunit`，后者返回
`{workUnitId,workUnitPath,sourceFingerprint,evidenceComplete,requiresMappingReview,truncation?}`。

目录结构为：

```text
.figma_bridge_agent/sessions/<sessionId>/work-units/<workUnitId>/
├─ source/current.json
├─ source/<sourceFingerprint>/<variant>/
│  ├─ manifest.json
│  ├─ outline.jsonl
│  ├─ facts.jsonl
│  └─ preview.png        # 可选
└─ implementation.json
```

索引与来源 manifest 使用 schema v4，只记录文件名和必要控制事实，不保存逐文件 SHA-256。

来源修订不可变。`implementation.json` 只在首次 prepare 时创建，此后工具永不覆盖。其固定
字段为 `sourceFingerprint`、`fidelityPolicy`、`state`、`targetFiles`、`mappings`、
`assumptions`、`unresolvedDifferences`。映射只记录实际产生代码的组件、选择器、资源和特殊
几何。facts 必须用 `rg` 按节点 ID 或名称定向读取，不得完整载入对话上下文。

刷新同一事实范围保持 `workUnitId`，写入新来源修订并更新 `source/current.json`。若实施指纹
落后，`requiresMappingReview` 为 true；复核映射前素材导出会返回
`WORKUNIT_SOURCE_STALE`。来源检查只接收 `workUnitId`。

## 素材导出

`figma_frontend_export_assets` 必须携带 `workUnitId` 和 1–32 个 item。服务端从 workunit
解析根节点与来源指纹，并在整批前后检查来源；调用方不能提交 `sourceGuard`。批次最多暂存
64 MiB，全部格式、路径与覆盖条件通过后才原子提交。

- `RAW` 提供 paint slot、索引和无扩展名 `outputPathStem`，按最终魔数追加扩展名。
- `RENDERED` 提供 PNG/JPG 的 scale，或不带 scale 的 SVG，并使用匹配扩展名。
- 返回项为 `{path,status,mimeType,intrinsicWidth,intrinsicHeight,dimensionUnit}`。

位图尺寸来自最终字节；SVG 使用根宽高或 `viewBox`。`OVERWRITE` 必须携带已检查的
`expectedExistingSha256`。

## Design 边界

所有针对现有设计的写入先通过 `figma_design_duplicate_as_proposal` 创建隔离副本。后续变更
串联 `proposalFingerprint`。DesignPlan 先调用 `figma_design_validate_plan`，再消费一次性 ID
调用 `figma_design_apply_plan`；完整递归计划仍由服务端严格解析。

## 显式原位编辑

仅在用户明确要求修改原稿时使用 figma_design_edit_in_place 或 figma_design_delete_nodes。先通过 figma_status.selection 读取选区并检查目标节点。必须携带 editMode（值为 IN_PLACE）、当前页 scopeRootId，以及通过 figma_design_read_source_fingerprint 的 nodeIds: [scopeRootId] 读取的完整树 expectedFingerprint。

编辑的 operations 支持 TEXT、LAYOUT、RESIZE、CREATE_FRAME、CAROUSEL，每批 1–100 项。文字、布局、Frame 字段沿用对应 Proposal 工具；RESIZE 使用 nodeId、width、height。CAROUSEL 使用 parentId、暂存位图 assetIds、width、height，可选 name、x、y、gap；提供演示模式横向滚动，不含自动播放。所有目标 ID 必须已存在，新节点 ID 通过 createdNodeIds 返回。后续写入使用返回的新 treeFingerprint。

删除使用相同 guard 及 1–100 个唯一 nodeIds，不得同时指定父子节点。删除整个范围根时返回 scopeRemoved: true、treeFingerprint: null。不创建或伪造 Proposal 标记。拒绝跨页、越界、锁定祖先、Instance 内部和过期指纹；删除还检查锁定子孙。字体加载后复查范围。预检失败不触碰 Undo，整批写入失败回滚，成功仅产生一个 Undo 单元。超时后先检查结果再重试。
