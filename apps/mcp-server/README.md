# figma-local-agent-mcp

Local-first stdio MCP server for the **Local Figma Agent Bridge** development plugin.

Requires Node.js 20 or newer. Pair once:

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

Then configure a Windows MCP client with `npx.cmd`, arguments
`-y`, `figma-local-agent-mcp@0.9.0`, `serve`.

The matching Figma plugin ZIP and complete documentation are distributed through the project's
GitHub Releases. This is an unofficial project and is not affiliated with or endorsed by Figma.
