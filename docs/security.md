# Security notes

[中文版](security.zh-CN.md)

This project is a local development tool, not a remote service.

## Protected properties

- Original Figma nodes are read-only by policy and by write-handler scope checks.
- Proposal identity is persisted in plugin data and cannot be supplied by name alone.
- Agent-supplied IDs express edit intent only. Clone roots are resolved by the plugin, detached to the Page, and checked against a source-context fingerprint before the isolated Proposal is revealed.
- The entire Proposal is writable, including cloned layout context, but writes cannot cross its marked root.
- A second plugin connection is rejected and cannot evict the active one.
- A captured authentication proof cannot be reused because each connection receives a fresh server nonce and supplies a fresh plugin nonce.
- Pairing is disabled by default. An explicit `pair` command opens one 120-second session, and the user must compare a six-digit SAS before the device credential is stored.
- X25519 and HKDF-SHA-256 derive a unique token for every paired plugin. The token is never transmitted over WebSocket and is separate from the Daemon credential used by MCP adapters.
- Long-running file output is bounded by payload and disk quotas.
- Temporary exports do not write into an agent workspace or user-selected project path.

## Operational guidance

- Use `devices list` and `devices revoke` to audit or remove paired plugins. Revocation disconnects an active device immediately.
- Do not expose port 3900 through a proxy or port-forward.
- Keep the Figma plugin status window open only while using the bridge.
- Review a Proposal visually before copying it into production artwork.
- Use Figma native Undo for user-directed history changes. The bridge uses undo only inside an anchored write boundary for the operation that has just failed; read-only validation failures never trigger undo.

## Explicit non-goals

There is no arbitrary script tool, source mutation switch, general delete, instance detach, OAuth flow, remote access, multi-host arbitration, or collaboration synchronization in v0.2.
