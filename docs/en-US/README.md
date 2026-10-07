# Local Figma Agent documentation

[中文版](../zh-CN/README.md) · [Project home](../../README.en-US.md)

These documents are for Local Figma Agent users, integrators, and contributors. If you only need to install it for the first time, start by [choosing an installation method](configuration.md).

## Users

- [Choose an installation method](configuration.md): compare the Agent Plugin and direct MCP routes.
- [Install the Agent Plugin](install-plugin.md): install the stable plugin and Skill in Codex, Cursor, or GitHub Copilot.
- [Configure the MCP Server directly](install-mcp-server.md): configure a stable, Development, or source build in Claude Code, Claude Desktop, and other stdio hosts.
- [MCP tool reference](tools.md): understand the 23 public tools, their write boundaries, and recommended call sequences.
- [Security notes](security.md): understand credential, network, asset, Proposal, and temporary-file boundaries.

## Developers and contributors

- [Architecture and safety model](architecture.md): processes, authentication, Proposal, DesignPlan, resources, and read limits.
- [Development guide](development.md): Monorepo structure, development commands, testing strategy, and release artifacts.
- [End-to-end acceptance](acceptance.md): validate pairing, reads, Proposals, DesignPlans, and resources using real distribution packages.

## Suggested paths

- First-time user: choose an installation method → matching installation guide → MCP tool reference → security notes.
- New MCP host integration: configure the MCP Server directly → architecture and safety model.
- Code changes: development guide → architecture and safety model → end-to-end acceptance.
