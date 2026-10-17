# 架构与安全模型

[English](../en-US/architecture.md) · [文档首页](README.md)

可移植 Agent Plugin 是 MCP 主机上方的分发层，只安装工作流说明和现有 stdio 启动配置；它不是新的运行时节点，也不会接收 Figma 数据或凭据。删除 Agent Plugin 并手动配置同一命令后，下述进程与信任边界完全相同。由于 Bridge 只绑定本机 loopback，ChatGPT Web、Codex Cloud 等纯远程环境不属于此架构的支持范围。

## 进程边界

```text
多个 MCP 主机（Codex / Claude Code / Cursor）
  ↕ 各自独立的 stdio 会话（stdout 仅用于 MCP）
每会话 MCP Adapter
  ↕ 已认证的 ws://127.0.0.1:3900/mcp
单例 Bridge Daemon
  ↕ 每设备认证的 ws://127.0.0.1:3900/
Figma 插件 UI
  ↕ 已验证的 postMessage
Figma 插件主进程
  ↕ Figma Plugin API
当前 Design 页面
```

显式 CLI 配对会话会临时启用 `ws://127.0.0.1:3900/pair`；正常运行时该路径保持关闭。

`packages/protocol` 负责与传输无关的 Zod schema，并分别定义插件 RPC 与公共 MCP 结果契约。每个 MCP Adapter 负责一个 stdio 会话、初始未绑定的 Agent 工作区和独立导出 session ID。自动管理的 Bridge Daemon 独占回环监听，只转发数据并把任意数量的已认证 MCP Adapter 复用到一个插件连接；它永远不写前端工程。插件 UI 负责插件侧身份验证和重连行为。插件主进程是唯一允许持有 Figma 对象的进程。

Server 在每个 Adapter 上静态注册全部 25 个工具。`figma_inspect_*`、`figma_frontend_*` 和 `figma_design_*` 前缀直接表达领域，不存在连接级工作流状态、动态句柄切换或旧工具 alias。

首个 Adapter 会在需要时启动 Daemon。关闭某个主机只会关闭自己的 Adapter。当最后一个 Adapter 和插件都断开 30 秒后，Daemon 自动退出。

## 信任边界

- WebSocket 服务器仅绑定到 `127.0.0.1`，只允许一个已认证插件，并在独立路径上允许多个已认证 MCP Adapter。
- MCP Adapter 使用内部 Daemon 凭据。每个插件在用户确认六位 SAS 后获得独立的 X25519/HKDF 派生 token，随后使用新鲜 nonce 和按角色、方向隔离的 HMAC-SHA-256 proof；凭据和 proof 均不能跨角色复用。
- RPC 信封以及每条 UI/主进程消息都会经过 schema 校验并受大小限制。
- Adapter 日志写入 stderr。后台 Daemon 在用户配置目录写入有界 `bridge.log`，并只保留一个轮转文件。日志仅包含请求 ID、RPC 方法、耗时和结果，排除密钥、图像 base64 和原始节点 JSON。
- `figma_inspect_render_preview` 的视觉预览和 `figma_inspect_browse_nodes` 的大型 JSONL 写入 `%TEMP%/figma-agent-mcp/<session-id>/`；该目录复用 Adapter 的 session ID。
- 当前 Adapter 的临时文件保留三十分钟并在关闭时立即删除。其他 Adapter 不会清理其中的单个文件或空目录；异常退出的会话目录在 `mtime` 超过二十四小时后由存活 Adapter 兜底删除。若运行中的旧会话目录因此被删除，该 Adapter 会在下次写入时自动重建。
- 结构索引、workunit 和素材由 Adapter 写文件，共享同一个不可变会话根绑定、路径校验和原子写入。会话初始为 `UNBOUND`。素材批次会在绑定工作区内使用瞬时会话暂存目录，并受 64 MiB 批次上限约束；提交或失败后都会清理暂存。Agent 必须在首次持久写入前用最新 session ID 把自身任务执行环境的绝对 cwd 绑定为工作区根；Adapter 不信任自身的 `process.cwd()`。

## 素材读取与导出生命周期

1. 紧凑节点读取枚举 Image Paint、导出设置、矢量和蒙版事实；同一序列化上下文按 image hash 缓存尺寸查询，内部 canonical snapshot 继续保留完整一致性指纹。
2. `figma_frontend_export_assets` 最多接受 32 个 RAW 或 RENDERED item，并要求 `workUnitId`。Adapter 从 workunit 解析根与已复核来源指纹；插件确认所有 item 位于该根内，并在整批前后匹配来源。
3. 插件通过协议 10 RPC 返回单项不超过 9 MiB 的原始字节、渲染字节或 SVG 字符串，Adapter 将整批解码后暂存限制为 64 MiB。公共 MCP 结果不会透出正文或来源指纹。
4. Adapter 对 RAW 再做 PNG/JPEG/GIF/WebP 魔数识别，对 RENDERED 核对格式、扩展名和载荷上限，并从最终字节读取位图像素尺寸；SVG 使用根宽高或 `viewBox`。无法得到有效固有尺寸时拒绝整批；解析后的输出路径必须唯一。
5. 所有来源、格式、路径和覆盖条件通过后，Adapter 才把全部内容写入瞬时会话暂存目录，复检目标并发变化，再以可恢复批次发布完整文件。任一步失败都会恢复备份目标，不留下部分项目更新。
6. 同路径同 hash 返回 `REUSED`；不同 hash 默认返回 `EXPORT_TARGET_CONFLICT`。显式覆盖要求现有 SHA-256，并在提交前再次核对以防并发修改。
7. 绑定必须在任何导出写入前完成，相同规范根可幂等重试，会话内不得切换到其他根。未绑定请求返回 `EXPORT_ROOT_UNBOUND`；成功按顺序返回 `{path,status,mimeType,intrinsicWidth,intrinsicHeight,dimensionUnit}`，不公开文件摘要。

## Workunit 生命周期

1. 大型页面可先由 `figma_frontend_index_scope` 生成结构索引；索引没有实施 facts。
2. `figma_frontend_prepare_workunit` 对根计算完整树指纹，按稳定次序生成扁平 outline 和不嵌套子节点的 facts。`factNodeIds` 只限制详细事实。
3. 来源改变返回 `WORKUNIT_SOURCE_CHANGED`；正文超过 12 MiB 返回 `PAYLOAD_TOO_LARGE`，两者都不写文件。
4. `workUnitId` 由根 ID 与排序后的事实节点 ID 稳定生成。来源修订写入 `source/<fingerprint>/<variant>/`，最后以 manifest 标记完成并更新服务端拥有的 `source/current.json`。
5. 工具只在首次 prepare 时创建 `implementation.json`，此后不覆盖。刷新后若实施指纹落后，Agent 必须复核实际代码映射再更新；素材导出在此之前返回 `WORKUNIT_SOURCE_STALE`。
6. Agent 仅映射实际产生代码的组件、选择器、资源和特殊几何。facts 留在 JSONL，通过节点 ID/名称定向查询。
7. 完成前调用 `figma_frontend_check_workunit_source(workUnitId)`；只有来源为 `FRESH`、实施指纹与当前来源一致且差异已解决或报告，才能把状态设为 `COMPLETE`。

## 源稿不可变

写入处理器只接受位于带有 `figma-agent-mcp:proposal` 插件数据标记的根节点内的节点。v3 标记增加 `GENERATED`/`CLONED` 来源、构建状态和 operation ID，同时继续读写 v2 Proposal。请求目标只描述意图；Proposal 根仍是写入边界，其中复制进来的全部上下文节点均可写。

`figma_design_duplicate_as_proposal` 接收编辑目标并自动解析复制根。Auto Layout 流式子节点包含其直接父级，普通叶节点包含最近的结构容器，Page 和 Section 会停止上探；Component Set 变体和绝对定位子节点不会扩张。解析范围最多包含 1000 个场景节点：推导出的上下文超限时会退回目标并返回警告，目标自身或合并请求超限时直接拒绝。单根副本直接移动到 Page，多根副本进入 Page 级透明包装器，因此 Proposal 不会留在原布局上下文。公共返回只映射请求的编辑目标及其解析原因；复制根和完整内部 ID 映射不对 Agent 暴露。

克隆前，插件会对源根、直接布局父级和兄弟几何生成指纹；副本脱离后再次验证，任何漂移都会返回 `SOURCE_CHANGED_DURING_CLONE` 并回滚。副本会递归解锁，而源节点的可见性、锁定、层级和几何不会改变。修改操作会串行执行，并拆分为只读预检阶段和写入阶段。预检失败绝不会触碰 undo 历史。由于空的 `commitUndo()` 和 Page plugin data 都不能建立 Figma undo 边界，写入阶段会创建一个不可见的临时节点作为 undo 锚点。失败时，桥接器先把锚点和可能存在的部分写入提交为当前单元，再立即撤销该单元。因此即使第一个业务写入前就失败，也只会回滚当前修改，不会撤销前一个成功操作。锚点会在成功提交前删除，在失败时随当前修改一起回滚；若插件崩溃遗留了不可见锚点，下一次成功修改会将其清理。公开的 undo 是有意不提供的，因为它可能撤销之后的手动编辑。

丢弃 Proposal 时必须提供最近一次检查得到的 Proposal 指纹。如果用户在检查后编辑了 Proposal，则返回 `PROPOSAL_CHANGED`，而不会删除它。应通过 `figma_design_read_source_fingerprint` 获取新的完整树指纹；紧凑节点事实有意不公开指纹，不能替代该值。

## DesignPlan 生命周期

1. Agent 检查规范化树和渲染结果，调用 `figma_inspect_list_fonts`、`figma_inspect_read_design_resources`，并按需逐个暂存 Base64 素材。公共素材句柄只包含 `assetId`、可选尺寸与过期时间；内部摘要不公开。
2. 对于带来源的计划，Agent 使用有序来源根 ID 调用 `figma_design_read_source_fingerprint`，并将相同顺序和返回的聚合指纹分别写入 `source.rootNodeIds` 与 `source.fingerprint`。
3. `figma_design_validate_plan` 检查 1000 节点/32 层上限、全局唯一 ref、当前页源节点和组件、显式字体、素材可用性、样式/变量兼容性、资源命名冲突和可选源指纹。验证请求外层可通过 `returnRefs` 选择最多 200 个不重复的节点或资源 ref；这些 ref 随验证缓存，但不参与 plan digest。
4. 有效计划会获得一个五分钟后过期且只能使用一次的验证 ID。
5. `figma_design_apply_plan` 消费该 ID，并在打开写入边界前重新检查所有可变依赖。公共 `refMap` 默认省略；请求后也只包含所选节点和资源 ref。
6. 插件创建带 v3 标记的隐藏根，创建或复用命名隔离的本地资源，构建节点树并绑定资源，提交 operation 标记后才显示 Proposal。
7. 预检失败不产生写入；写入失败会显式删除本次新资源并触发带锚点的回滚。插件崩溃后，下一次写操作会删除孤立的 `BUILDING` 根/资源；若 Proposal 已提交，则补全对应资源标记。

DesignPlan v1 支持 Frame、Text、Rectangle、Ellipse、Line、Image、SVG、Clone 和 Instance，支持完整几何/视觉/Auto Layout/文本 range、显式字体回退、样式和变量绑定，以及当前页组件复用。它不会 detach Instance，也不会修改受保护的 Instance 内部结构。

## 素材和资源边界

- 输入只接受 Base64；MCP Server 不抓取 URL，也不读取调用方提供的本地路径。
- 位图校验魔数并限制为 8 MiB/4096 px；SVG 经解析、清理和重新序列化，限制为 2 MiB/16384 单位。
- 插件缓存上限 32 MiB、TTL 十分钟，断线清空；内部仍把 `assetId` 与 SHA-256 配对以校验完整性和去重，公共结果与 DesignPlan 只使用 `assetId`。
- 新资源命名为 `Agent/<Proposal>/<name>`；同名同结构复用，不同内容返回 `RESOURCE_CONFLICT`。成功资源不会随 Proposal 丢弃而删除。
- 变量只有一个 `Default` 模式，仅创建 COLOR/FLOAT/STRING/BOOLEAN。不会调用 Team Library 或 import-by-key API。

## 读取限制

- 树：默认深度 2、200 个节点；硬限制为深度 8、1000 个节点。
- 文本：由调用方限制长度，并在截断时明确标记。
- 渲染：请求的最大尺寸为 2048 px，原始 PNG 限制为 9 MiB（使编码后的 RPC 载荷保持在桥接限制以内）。
- 持久素材导出：每批最多 32 项、单项最多 9 MiB，整批解码后最多 64 MiB。
- 原始 REST JSON：默认只返回自节点，可显式读取一层子节点，并可投影最多 32 个唯一顶层字段；默认限制 256 KiB，请求硬限制为 2 MiB。
- Workunit 来源 RPC 正文：12 MiB；超限要求缩小根范围或拆分事实节点。
- 持久素材、结构索引与 workunit 写入必须先绑定工作区；临时树/渲染存储继续使用独立 TTL 与配额控制。

`getCSSAsync()` 返回的 CSS 会标记为代码生成提示。规范化快照仍然是结构事实来源。
