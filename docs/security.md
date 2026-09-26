# Security notes

[中文版](security.zh-CN.md)

This project is a local development tool, not a remote service.

## Protected properties

- Original Figma nodes are read-only by policy and by write-handler scope checks.
- Proposal identity is persisted in plugin data and cannot be supplied by name alone.
- A second plugin connection is rejected and cannot evict the active one.
- A captured authentication proof cannot be reused because each connection receives a fresh server nonce and supplies a fresh plugin nonce.
- Long-running file output is bounded by payload and disk quotas.
- Temporary exports do not write into an agent workspace or user-selected project path.

## Operational guidance

- Treat the pairing secret like a local credential. Re-run `setup` to rotate it, then paste the new value into the plugin.
- Do not expose port 3900 through a proxy or port-forward.
- Keep the Figma plugin status window open only while using the bridge.
- Review a Proposal visually before copying it into production artwork.
- Use Figma native Undo for user-directed history changes. The bridge uses undo only internally for an operation that has just failed.

## Explicit non-goals

There is no arbitrary script tool, source mutation switch, general delete, instance detach, OAuth flow, HTTP listener, remote access, multi-host arbitration, or collaboration synchronization in v0.1.
