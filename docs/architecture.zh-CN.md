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

写入处理器只接受位于带有 `figma-agent-mcp:proposal` 插件数据标记的根节点内的节点。标记包含 schema 版本、源节点 ID 和创建时间，因此在插件重启后仍然有效。

`figma_duplicate_as_proposal` 会克隆单个子树，或将多个克隆放入透明包装器，并返回完整的源节点到克隆节点 ID 映射。修改操作会串行执行，并拆分为只读预检阶段和写入阶段。预检失败绝不会触碰 undo 历史。由于空的 `commitUndo()` 和 Page plugin data 都不能建立 Figma undo 边界，写入阶段会创建一个不可见的临时节点作为 undo 锚点。失败时，桥接器先把锚点和可能存在的部分写入提交为当前单元，再立即撤销该单元。因此即使第一个业务写入前就失败，也只会回滚当前修改，不会撤销前一个成功操作。锚点会在成功提交前删除，在失败时随当前修改一起回滚；若插件崩溃遗留了不可见锚点，下一次成功修改会将其清理。公开的 undo 是有意不提供的，因为它可能撤销之后的手动编辑。

丢弃 Proposal 时必须提供最近一次检查得到的 Proposal 指纹。如果用户在检查后编辑了 Proposal，则返回 `PROPOSAL_CHANGED`，而不会删除它。

## LayoutPlan 生命周期

1. agent 读取规范化快照、有界树以及可选的渲染结果。
2. `figma_validate_layout_plan` 检查当前页面归属、源根节点隔离、引用唯一性、Instance 边界、完整覆盖范围以及当前源指纹。
3. 有效计划会获得一个五分钟后过期且只能使用一次的验证 ID。
4. `figma_apply_layout_plan` 消费该 ID，并重新计算源指纹。
5. 插件克隆源节点，隐藏临时 Proposal，从叶节点到根节点构建嵌套 Frame，应用 Auto Layout，将结果放置在源节点旁边，添加标记后显示结果。
6. 预检失败会在打开 undo 边界之前退出；写入阶段失败会移除临时根节点，并触发带锚点的内部回滚边界。

v1 schema 允许水平/垂直 Auto Layout、尺寸设置、对齐和绝对定位覆盖层。它会拒绝 GRID、WRAP、detach、重复引用、祖先/后代双重引用，以及现有容器中的遗漏引用。

## 读取限制

- 树：默认深度 2、200 个节点；硬限制为深度 8、1000 个节点。
- 文本：由调用方限制长度，并在截断时明确标记。
- 渲染：请求的最大尺寸为 2048 px，原始 PNG 限制为 9 MiB（使编码后的 RPC 载荷保持在桥接限制以内）。
- 原始 REST JSON：默认 2 MiB，请求硬限制为 8 MiB。
- 临时资源：每个服务器会话 256 MiB。

`getCSSAsync()` 返回的 CSS 会标记为代码生成提示。规范化快照仍然是结构事实来源。
