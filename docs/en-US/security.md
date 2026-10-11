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
- Long-running file output is bounded to 9 MiB per item and 256 MiB per staged session.
- Every MCP Adapter initially writes only to its independent `~/figma_bridge_agent_export/<session-id>/`. Before the first export, the Agent may submit the absolute cwd from its own task execution environment together with the latest session ID. The Adapter validates realpath, directory type, writability, and dangerous locations, then freezes the canonical root for that session.
- Binding rejects filesystem roots, the user home itself, plugin roots, plugin data directories, and staging directories or their descendants. A session cannot bind after writing starts or switch to another root. Unbound sessions remain for 24 hours so interrupted work can recover. The shared Daemon never writes project files.
- Exports reject traversal, drive/UNC/absolute paths, NUL, symlink/junction escapes, and non-regular targets. Missing ordinary directories may be created only inside the frozen root.
- Files are committed through a same-directory temporary file and rename. Identical content is reused; different content is rejected by default. Overwrite requires the existing SHA-256 just inspected by the caller and rechecks it before commit.
- Inbound design assets are accepted only as Base64, validated and bounded before reaching the plugin, and never trigger an external network request.
- DesignPlan component discovery is limited to the current page. The plugin has no `teamlibrary` permission and never calls Team Library or import-by-key APIs.
- Existing styles, variables, and components are read-only. New local resources use the `Agent/<Proposal>/...` namespace, are removed on failed builds, and persist after a successful build.

## Operational guidance

- Use `devices list` and `devices revoke` to audit or remove paired plugins. Revocation disconnects an active device immediately.
- Do not expose port 3900 through a proxy or port-forward.
- Keep the Figma plugin status window open only while using the bridge.
- Review a Proposal visually before copying it into production artwork.
- Check `figma_status` for `WORKSPACE` versus `STAGED`. During implementation, call `figma_bind_export_root` with the latest session ID. If binding is unavailable or fails, copy staged results to the returned project-relative path and verify SHA-256; never put a staging path into generated code.
- Use Figma native Undo for user-directed history changes. The bridge uses undo only inside an anchored write boundary for the operation that has just failed; read-only validation failures never trigger undo.

## Explicit non-goals

The current release has no arbitrary script tool, source mutation switch, general delete, Instance detach, Team Library crawler, OAuth flow, remote access, multi-host arbitration, or collaboration synchronization.
