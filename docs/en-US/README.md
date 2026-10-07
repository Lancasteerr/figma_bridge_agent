# Local Figma Agent documentation

[中文版](../zh-CN/README.md) · [Project home](../../README.en-US.md)

These documents are for Local Figma Agent users, integrators, and contributors. If you only need to install it for the first time, start with [installation and configuration](configuration.md).

## Users

- [Installation and configuration](configuration.md): choose a stable release, Development build, or source build; pair the plugin; and troubleshoot common problems.
- [Windows MCP host configuration](hosts.md): manually configure the stdio Server in Codex, Claude, ChatGPT Desktop, Cursor, and other hosts.
- [MCP tool reference](tools.md): understand the 23 public tools, their write boundaries, and recommended call sequences.
- [Security notes](security.md): understand credential, network, asset, Proposal, and temporary-file boundaries.

## Developers and contributors

- [Architecture and safety model](architecture.md): processes, authentication, Proposal, DesignPlan, resources, and read limits.
- [Development guide](development.md): Monorepo structure, development commands, testing strategy, and release artifacts.
- [End-to-end acceptance](acceptance.md): validate pairing, reads, Proposals, DesignPlans, and resources using real distribution packages.

## Suggested paths

- First-time user: installation and configuration → MCP tool reference → security notes.
- New MCP host integration: host configuration → architecture and safety model.
- Code changes: development guide → architecture and safety model → end-to-end acceptance.
