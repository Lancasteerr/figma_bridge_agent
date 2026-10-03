# Owner release runbook

[中文版](releasing.zh-CN.md)

1. Update every first-party package and the portable Agent Plugin to the same version, run `pnpm build:release`, and inspect these four files under `artifacts/`: the Figma plugin ZIP, npm tarball, Agent Plugin ZIP, and `SHA256SUMS`.
2. Commit the version, create an annotated `v<version>` tag on that commit, and push the commit and tag.
3. In GitHub repository settings, create a protected environment named `release` and require owner approval.
4. For the first npm publication, add a short-lived granular publish token as the `NPM_TOKEN` environment secret. After the package exists, configure npm Trusted Publishing for `.github/workflows/release.yml` and remove the token.
5. Run **Manual release** from GitHub Actions for the existing tag with npm publishing enabled first. Confirm `npm view figma-local-agent-mcp@<version> version` succeeds, then create the GitHub Release from the same workflow artifacts.

The workflow validates the tag, all first-party package versions, and the portable Agent Plugin version; rebuilds from the tag; refuses an existing npm version; and uses the same artifacts for GitHub and npm. Do not announce the repository marketplace as installable until the matching npm version is public, because its `mcp.json` deliberately pins that exact release. It never edits or creates a tag.
