# Security notes

[中文版](../zh-CN/security.md) · [Documentation home](README.md)

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
- Inbound design assets are accepted only as Base64, validated and bounded before reaching the plugin, and never trigger an external network request.
- DesignPlan component discovery is limited to the current page. The plugin has no `teamlibrary` permission and never calls Team Library or import-by-key APIs.
- Existing styles, variables, and components are read-only. New local resources use the `Agent/<Proposal>/...` namespace, are removed on failed builds, and persist after a successful build.

## Operational guidance

- Use `devices list` and `devices revoke` to audit or remove paired plugins. Revocation disconnects an active device immediately.
- Do not expose port 3900 through a proxy or port-forward.
- Keep the Figma plugin status window open only while using the bridge.
- Review a Proposal visually before copying it into production artwork.
- Use Figma native Undo for user-directed history changes. The bridge uses undo only inside an anchored write boundary for the operation that has just failed; read-only validation failures never trigger undo.

## Explicit non-goals

The current release has no arbitrary script tool, source mutation switch, general delete, Instance detach, Team Library crawler, OAuth flow, remote access, multi-host arbitration, or collaboration synchronization.
