# 架构与安全模型

[English](architecture.md)

## 进程边界

```text
MCP 主机
  ↕ stdio（stdout 仅用于 MCP）
apps/mcp-server
  ↕ 已认证的 ws://127.0.0.1:3900
Figma 插件 UI
  ↕ 已验证的 postMessage
Figma 插件主进程
  ↕ Figma Plugin API
当前 Design 页面
```

`packages/protocol` 负责与传输无关的 Zod schema。MCP 服务器负责 stdio、回环代理、临时文件和诊断信息。插件 UI 负责身份验证和重连行为。插件主进程是唯一允许持有 Figma 对象的进程。

## 信任边界

- WebSocket 服务器仅绑定到 `127.0.0.1`，并且只允许一个经过身份验证的插件。
- 配对使用新的服务器和插件 nonce，以及双向的 HMAC-SHA-256 证明。密钥不会通过 socket 发送。
- RPC 信封以及每条 UI/主进程消息都会经过 schema 校验并受大小限制。
- 日志写入 stderr，仅包含请求 ID、RPC 方法、耗时和结果。日志排除密钥、图像 base64 和原始节点 JSON。
- 导出文件写入 `%TEMP%/figma-agent-mcp/<session>/` 下的隔离目录，文件名会经过清理并附带 SHA-256 元数据，程序关闭时删除。启动时会清理超过 24 小时的会话。

## 源稿不可变

写入处理器只接受位于带有 `figma-agent-mcp:proposal` 插件数据标记的根节点内的节点。标记包含 schema 版本、源节点 ID 和创建时间，因此在插件重启后仍然有效。

`figma_duplicate_as_proposal` 会克隆单个子树，或将多个克隆放入透明包装器，并返回完整的源节点到克隆节点 ID 映射。修改操作会串行执行。发生即时部分失败时，会在同一修改边界内回滚；公开的 undo 是有意不提供的，因为它可能撤销之后的手动编辑。

丢弃 Proposal 时必须提供最近一次检查得到的 Proposal 指纹。如果用户在检查后编辑了 Proposal，则返回 `PROPOSAL_CHANGED`，而不会删除它。

## LayoutPlan 生命周期

1. agent 读取规范化快照、有界树以及可选的渲染结果。
2. `figma_validate_layout_plan` 检查当前页面归属、源根节点隔离、引用唯一性、Instance 边界、完整覆盖范围以及当前源指纹。
3. 有效计划会获得一个五分钟后过期且只能使用一次的验证 ID。
4. `figma_apply_layout_plan` 消费该 ID，并重新计算源指纹。
5. 插件克隆源节点，隐藏临时 Proposal，从叶节点到根节点构建嵌套 Frame，应用 Auto Layout，将结果放置在源节点旁边，添加标记后显示结果。
6. 任何失败都会移除临时根节点，并触发内部修改回滚边界。

v1 schema 允许水平/垂直 Auto Layout、尺寸设置、对齐和绝对定位覆盖层。它会拒绝 GRID、WRAP、detach、重复引用、祖先/后代双重引用，以及现有容器中的遗漏引用。

## 读取限制

- 树：默认深度 2、200 个节点；硬限制为深度 8、1000 个节点。
- 文本：由调用方限制长度，并在截断时明确标记。
- 渲染：请求的最大尺寸为 2048 px，原始 PNG 限制为 9 MiB（使编码后的 RPC 载荷保持在桥接限制以内）。
- 原始 REST JSON：默认 2 MiB，请求硬限制为 8 MiB。
- 临时资源：每个服务器会话 256 MiB。

`getCSSAsync()` 返回的 CSS 会标记为代码生成提示。规范化快照仍然是结构事实来源。
