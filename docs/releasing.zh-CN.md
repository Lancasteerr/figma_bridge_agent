# Owner 发布手册

[English](releasing.md)

1. 同时更新公开服务器包和插件包版本，运行 `pnpm build:release`，检查 `artifacts/` 下的三个文件。
2. 提交版本变更，在该提交上创建带注释的 `v<version>` tag，并推送提交和 tag。
3. 在 GitHub 仓库设置中创建名为 `release` 的受保护 Environment，并要求 owner 审批。
4. 首次发布 npm 时，将短期 granular publish token 配置为该 Environment 的 `NPM_TOKEN` secret。包创建后，改为针对 `.github/workflows/release.yml` 的 npm Trusted Publishing，并删除 token。
5. 在 GitHub Actions 手动运行 **Manual release**，选择已经存在的 tag，并分别决定是否创建 GitHub Release、是否发布 npm。

工作流会验证 tag 与两个包版本，从 tag 重新构建，拒绝覆盖已有 npm 版本，并让 GitHub 与 npm 使用同一批产物。工作流不会修改源码或创建 tag。
