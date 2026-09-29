# Owner release runbook

[中文版](releasing.zh-CN.md)

1. Update the public server and plugin package versions together, run `pnpm build:release`, and review all three files under `artifacts/`.
2. Commit the version, create an annotated `v<version>` tag on that commit, and push the commit and tag.
3. In GitHub repository settings, create a protected environment named `release` and require owner approval.
4. For the first npm publication, add a short-lived granular publish token as the `NPM_TOKEN` environment secret. After the package exists, configure npm Trusted Publishing for `.github/workflows/release.yml` and remove the token.
5. Run **Manual release** from GitHub Actions. Select the existing tag and independently choose whether to create the GitHub Release and publish npm.

The workflow validates the tag and both package versions, rebuilds from the tag, refuses an existing npm version, and uses the same artifacts for GitHub and npm. It never edits or creates a tag.
