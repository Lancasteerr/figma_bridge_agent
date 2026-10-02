# 架构与安全模型

[English](architecture.md)

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

`packages/protocol` 负责与传输无关的 Zod schema。每个 MCP Adapter 负责一个 stdio 会话及其临时文件。自动管理的 Bridge Daemon 独占回环监听，并把任意数量的已认证 MCP Adapter 复用到一个插件连接。插件 UI 负责插件侧身份验证和重连行为。插件主进程是唯一允许持有 Figma 对象的进程。

首个 Adapter 会在需要时启动 Daemon。关闭某个主机只会关闭自己的 Adapter。当最后一个 Adapter 和插件都断开 30 秒后，Daemon 自动退出。

## 信任边界

- WebSocket 服务器仅绑定到 `127.0.0.1`，只允许一个已认证插件，并在独立路径上允许多个已认证 MCP Adapter。
- MCP Adapter 使用内部 Daemon 凭据。每个插件在用户确认六位 SAS 后获得独立的 X25519/HKDF 派生 token，随后使用新鲜 nonce 和按角色、方向隔离的 HMAC-SHA-256 proof；凭据和 proof 均不能跨角色复用。
- RPC 信封以及每条 UI/主进程消息都会经过 schema 校验并受大小限制。
- Adapter 日志写入 stderr。后台 Daemon 在用户配置目录写入有界 `bridge.log`，并只保留一个轮转文件。日志仅包含请求 ID、RPC 方法、耗时和结果，排除密钥、图像 base64 和原始节点 JSON。
- 导出文件写入 `%TEMP%/figma-agent-mcp/<session>/` 下的隔离目录，文件名会经过清理并附带 SHA-256 元数据，程序关闭时删除。启动时会清理超过 24 小时的会话。

## 源稿不可变

写入处理器只接受位于带有 `figma-agent-mcp:proposal` 插件数据标记的根节点内的节点。v3 标记增加 `GENERATED`/`CLONED` 来源、构建状态和 operation ID，同时继续读写 v2 Proposal。请求目标只描述意图；Proposal 根仍是写入边界，其中复制进来的全部上下文节点均可写。

`figma_duplicate_as_proposal` 接收编辑目标并自动解析复制根。Auto Layout 流式子节点包含其直接父级，普通叶节点包含最近的结构容器，Page 和 Section 会停止上探；Component Set 变体和绝对定位子节点不会扩张。解析范围最多包含 1000 个场景节点：推导出的上下文超限时会退回目标并返回警告，目标自身或合并请求超限时直接拒绝。单根副本直接移动到 Page，多根副本进入 Page 级透明包装器，因此 Proposal 不会留在原布局上下文。返回值包含复制根、目标映射、解析原因、警告和完整源到副本 ID 映射。

克隆前，插件会对源根、直接布局父级和兄弟几何生成指纹；副本脱离后再次验证，任何漂移都会返回 `SOURCE_CHANGED_DURING_CLONE` 并回滚。副本会递归解锁，而源节点的可见性、锁定、层级和几何不会改变。修改操作会串行执行，并拆分为只读预检阶段和写入阶段。预检失败绝不会触碰 undo 历史。由于空的 `commitUndo()` 和 Page plugin data 都不能建立 Figma undo 边界，写入阶段会创建一个不可见的临时节点作为 undo 锚点。失败时，桥接器先把锚点和可能存在的部分写入提交为当前单元，再立即撤销该单元。因此即使第一个业务写入前就失败，也只会回滚当前修改，不会撤销前一个成功操作。锚点会在成功提交前删除，在失败时随当前修改一起回滚；若插件崩溃遗留了不可见锚点，下一次成功修改会将其清理。公开的 undo 是有意不提供的，因为它可能撤销之后的手动编辑。

丢弃 Proposal 时必须提供最近一次检查得到的 Proposal 指纹。如果用户在检查后编辑了 Proposal，则返回 `PROPOSAL_CHANGED`，而不会删除它。应通过 `figma_get_fingerprint` 获取新的完整树指纹；有界节点快照中携带的指纹覆盖范围不同，不能替代该值。

## DesignPlan 生命周期

1. Agent 检查规范化树和渲染结果，调用 `figma_list_fonts`、`figma_get_design_resources`，并按需逐个暂存 Base64 素材。
2. 对于带来源的计划，Agent 使用有序来源根 ID 调用 `figma_get_fingerprint`，并将相同顺序和返回的聚合指纹分别写入 `source.rootNodeIds` 与 `source.fingerprint`。
3. `figma_validate_design_plan` 检查 1000 节点/32 层上限、全局唯一 ref、当前页源节点和组件、显式字体、素材摘要、样式/变量兼容性、资源命名冲突和可选源指纹。
4. 有效计划会获得一个五分钟后过期且只能使用一次的验证 ID。
5. `figma_apply_design_plan` 消费该 ID，并在打开写入边界前重新检查所有可变依赖。
6. 插件创建带 v3 标记的隐藏根，创建或复用命名隔离的本地资源，构建节点树并绑定资源，提交 operation 标记后才显示 Proposal。
7. 预检失败不产生写入；写入失败会显式删除本次新资源并触发带锚点的回滚。插件崩溃后，下一次写操作会删除孤立的 `BUILDING` 根/资源；若 Proposal 已提交，则补全对应资源标记。

DesignPlan v1 支持 Frame、Text、Rectangle、Ellipse、Line、Image、SVG、Clone 和 Instance，支持完整几何/视觉/Auto Layout/文本 range、显式字体回退、样式和变量绑定，以及当前页组件复用。它不会 detach Instance，也不会修改受保护的 Instance 内部结构。

## 素材和资源边界

- 输入只接受 Base64；MCP Server 不抓取 URL，也不读取调用方提供的本地路径。
- 位图校验魔数并限制为 8 MiB/4096 px；SVG 经解析、清理和重新序列化，限制为 2 MiB/16384 单位。
- 插件缓存上限 32 MiB、TTL 十分钟，断线清空；`assetId` 始终与 SHA-256 配对。
- 新资源命名为 `Agent/<Proposal>/<name>`；同名同结构复用，不同内容返回 `RESOURCE_CONFLICT`。成功资源不会随 Proposal 丢弃而删除。
- 变量只有一个 `Default` 模式，仅创建 COLOR/FLOAT/STRING/BOOLEAN。不会调用 Team Library 或 import-by-key API。

## 读取限制

- 树：默认深度 2、200 个节点；硬限制为深度 8、1000 个节点。
- 文本：由调用方限制长度，并在截断时明确标记。
- 渲染：请求的最大尺寸为 2048 px，原始 PNG 限制为 9 MiB（使编码后的 RPC 载荷保持在桥接限制以内）。
- 原始 REST JSON：默认 2 MiB，请求硬限制为 8 MiB。
- 临时资源：每个服务器会话 256 MiB。

`getCSSAsync()` 返回的 CSS 会标记为代码生成提示。规范化快照仍然是结构事实来源。
