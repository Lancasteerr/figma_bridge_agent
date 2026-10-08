# Install the Agent Plugin

[中文版](../zh-CN/install-plugin.md) · [Choose an installation method](configuration.md) · [Documentation home](README.md)

This guide is for Codex, GitHub Copilot, and Cursor, which currently have Agent Plugin entry points maintained by this project. The plugin installs both:

- a local stdio MCP Server launch configuration pinned to the matching release; and
- a Skill that teaches the agent to read Figma safely, create isolated Proposals, and use DesignPlan.

After installing the Agent Plugin, do not manually register another MCP Server named `figma-local-agent`, or the client may load duplicate tools. This route supports stable releases only. The Development Release does not currently provide an Agent Plugin.

## Requirements

- Windows
- Node.js 20 or newer
- Figma Desktop
- A supported local version of Codex, GitHub Copilot, or Cursor

Open the [latest GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest), note the version without the `v` prefix, and replace every `<VERSION>` on this page with it. The Agent Plugin, MCP npm package, and Figma plugin ZIP must remain on the same version.

## 1. Install the Agent Plugin

Choose only the method for your current client.

### Codex CLI and ChatGPT desktop

Import the version-pinned repository marketplace in PowerShell:

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v<VERSION>
```

Then run `/plugins` in Codex, choose the `figma-local-agent` marketplace, and install **Local Figma Agent**.

### GitHub Copilot CLI

```powershell
copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v<VERSION>
copilot plugin install figma-local-agent@figma-local-agent
```

To install only the plugin without registering its marketplace, use:

```powershell
copilot plugin install Lancasteerr/figma_bridge_agent:plugins/figma-local-agent
```

### Cursor

1. A team administrator opens **Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo**.
2. Import `https://github.com/Lancasteerr/figma_bridge_agent`.
3. Developers find **Local Figma Agent** under **Customize**, select **Install**, and choose user or project scope.

For local development, copy `plugins/figma-local-agent` to `~/.cursor/plugins/local/figma-local-agent` and reload Cursor. Team editions also require an administrator to allow Local Plugin Imports.

## 2. Import the matching Figma plugin

Download `figma-agent-bridge-plugin-v<VERSION>.zip` from the [latest GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) and extract it to a directory that will not be moved or deleted.

In **Figma Desktop → Plugins → Development → Import plugin from manifest**, select:

```text
figma-agent-bridge-plugin/manifest.json
```

This is an unofficial development tool distributed through GitHub. It is not published to Figma Community.

## 3. Complete first-time pairing

Pairing is shared initialization between the Figma plugin and the local Bridge. It is not a second MCP installation method.

1. Start **Local Figma Agent Bridge** in Figma and keep its window open.
2. Run in PowerShell:

   ```powershell
   npx -y figma-local-agent-mcp@<VERSION> pair
   ```

3. The terminal and Figma plugin each display a six-digit code. Click **Codes match** only when both codes are identical.

After pairing, the plugin stores an independent device credential and authenticates automatically on later starts. The credential is not written into the Agent Plugin.

## 4. Restart and verify

Restart ChatGPT/Cursor, or start a new Codex or Copilot agent session, so the newly installed plugin is loaded. Then:

1. Confirm the client loads only one `figma-local-agent` MCP Server.
2. Ask the agent to call `figma_status`.
3. Confirm the result includes protocol v4, the current Figma file, page, selection, and Bridge capabilities.
4. Confirm the **Local Figma Agent** Skill is available and can guide the Proposal workflow.

## Updates and troubleshooting

- Update the Agent Plugin and Figma plugin together. Do not let the npm version in `mcp.json` differ from the Figma plugin version.
- If the plugin is missing, refresh or re-import the marketplace and confirm that you selected the `v<VERSION>` tag containing the platform entry point.
- If tools appear twice, remove the previously registered MCP Server with the same name and start a new session.
- `PLUGIN_NOT_CONNECTED` means the Figma plugin is closed, not paired, or on a mismatched version.
- Run `npx -y figma-local-agent-mcp@<VERSION> doctor` to inspect the local Bridge state.

If the client does not have an Agent Plugin entry point maintained by this project, [configure the MCP Server directly](install-mcp-server.md).
