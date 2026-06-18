# 发版指南

这份文档面向人类维护者，说明如何发布一个新的 macOS DMG，并让用户可以通过 Homebrew 安装。

## 发布新版本

推荐使用交互式发版脚本：

```bash
pnpm release
```

脚本会引导选择 `patch`、`minor`、`major`、`beta` 或输入具体版本号，填写本次更新内容，随后自动：

1. 调用 `pnpm release:version` 同步版本文件。
2. 创建符合 Lore 协议的版本 commit。
3. 创建 `v版本号` tag。
4. push 当前分支和 tag，触发 GitHub Release workflow。

默认要求当前分支是 `main` 且工作区干净。可先预览：

```bash
pnpm release patch --dry-run
```

如果脚本在 `pnpm release:version` 之后、commit/tag 之前中断，可以在确认版本文件已经正确更新后继续：

```bash
pnpm release --resume
```

也可以显式指定：

```bash
pnpm release minor --notes "改进文件树体验"
pnpm release beta --notes "测试新版编辑器"
pnpm release 0.3.0-beta.1
```

如果只想手动更新版本号，可以执行：

```bash
pnpm release:version patch
```

也可以使用：

```bash
pnpm release:version minor
pnpm release:version major
pnpm release:version 0.2.0
```

然后提交并推送到 `main`，等待分支构建校验通过：

```bash
git add .
git commit -m "Prepare release v0.1.3"
git push origin main
```

确认 `main` 上的校验构建通过后，创建并推送版本 tag：

```bash
git tag v0.1.3
git push origin v0.1.3
```

## Beta 版本

`pnpm release beta` 会生成下一个 beta 版本：

- 当前 `0.2.1` -> `0.2.2-beta.1`
- 当前 `0.2.2-beta.1` -> `0.2.2-beta.2`

也可以直接输入具体 beta 版本，例如 `0.3.0-beta.1`。

Beta tag 会触发 Release workflow，并生成 GitHub prerelease。Beta 版本不会上传到公开 Homebrew tap，也不会更新 Homebrew cask。

## 自动化会做什么

普通分支、`main` 分支和 PR 会自动：

1. 安装依赖。
2. 执行 lint、typecheck 和 test。
3. 构建 macOS DMG。
4. 上传 DMG workflow artifact，方便检查构建产物。

推送 `v*` tag 后，独立的 Release workflow 会重新执行校验和构建，然后继续：

1. 校验 tag 名必须等于版本号生成的 `v版本号`。
2. 创建或更新 GitHub Release。
3. 把 DMG 上传到 Release 页面。
4. 如果是 beta / prerelease，把 GitHub Release 标记为 prerelease 并停止，不更新 Homebrew。
5. 如果是 stable，计算 DMG 的 sha256。
6. 如果是 stable，把 DMG 复制到公开的 `wmasfoe/homebrew-tap` Release，供 Homebrew 匿名下载。
7. 如果是 stable，读取公开 Release 里真实的 DMG 下载地址。
8. 如果是 stable，更新 `wmasfoe/homebrew-tap` 里的 Homebrew cask。

## 用户怎样安装

Release 成功后，用户可以直接下载 GitHub Release 里的 DMG。

也可以用 Homebrew 安装：

```bash
brew install --cask wmasfoe/tap/md-editor
```

## 检查是否成功

发版 tag 构建成功后检查三个地方：

- `wmasfoe/md-editor` 的 Release 页面有新的 DMG。
- `wmasfoe/homebrew-tap` 里有 `Casks/md-editor.rb`，版本号和 sha256 已更新。
- `wmasfoe/homebrew-tap` 的 Release 页面有 `md-editor-v版本号`，并带有同一个 DMG。

## 常见问题

- 分支 push 和 PR 不会发 Release，只会 lint、typecheck、test、构建 DMG 并上传 workflow artifact。
- `main` push 不会发 Release。只有推送 `v*` tag 才会发 Release 和更新 Homebrew。
- 如果 tag 构建失败并提示版本不匹配，说明 tag 名和项目版本号不同，例如项目版本是 `0.1.3` 时必须推送 `v0.1.3`。
- 如果本地发版脚本已经改了版本文件但还没创建 commit/tag，使用 `pnpm release --resume` 继续。
- beta 版本只发 GitHub prerelease，不上传 Homebrew tap，也不更新 cask。
- 如果 Homebrew tap 更新失败，优先检查 `HOMEBREW_TAP_TOKEN` 是否过期或权限不足。
- 如果日志里已经出现 `Wrote homebrew-tap/Casks/md-editor.rb`，但随后说 `Homebrew cask is already up to date.`，说明 cask 已生成，问题通常在 workflow 的 git 变更判断。
- 如果 `brew install` 下载 DMG 时 404，通常是 cask 指向了私有 `wmasfoe/md-editor` 的 Release。Homebrew 需要指向公开 `wmasfoe/homebrew-tap` Release 里的 DMG。
- 如果 cask 里的 DMG 文件名和 GitHub Release 页面看到的不一样，以 Release 页面和 workflow 读取到的真实 asset URL 为准。GitHub 可能会把文件名里的空格显示或处理成点。
- 如果 Homebrew 提示 sha256 不匹配，重新跑对应 `v*` tag 的 Actions，或检查 Release DMG 是否被手动替换过。
