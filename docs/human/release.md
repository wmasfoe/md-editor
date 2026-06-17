# 发版指南

这份文档面向人类维护者，说明如何发布一个新的 macOS DMG，并让用户可以通过 Homebrew 安装。

## 发布新版本

在本地执行：

```bash
pnpm release:version patch
```

也可以使用：

```bash
pnpm release:version minor
pnpm release:version major
pnpm release:version 0.2.0
```

然后提交并推送到 `main`：

```bash
git add .
git commit -m "Prepare release v0.1.3"
git push origin main
```

## 自动化会做什么

推送到 `main` 后，GitHub Actions 会自动：

1. 构建 macOS DMG。
2. 创建或更新 GitHub Release。
3. 把 DMG 上传到 Release 页面。
4. 计算 DMG 的 sha256。
5. 更新 `wmasfoe/homebrew-tap` 里的 Homebrew cask。

## 用户怎样安装

Release 成功后，用户可以直接下载 GitHub Release 里的 DMG。

也可以用 Homebrew 安装：

```bash
brew install --cask wmasfoe/tap/md-editor
```

## 检查是否成功

发版后检查两个地方：

- `wmasfoe/md-editor` 的 Release 页面有新的 DMG。
- `wmasfoe/homebrew-tap` 里有 `Casks/md-editor.rb`，版本号和 sha256 已更新。

## 常见问题

- 非 main 分支不会发 Release，只会构建。
- PR 不会发 Release，只会构建。
- 如果 Homebrew tap 更新失败，优先检查 `HOMEBREW_TAP_TOKEN` 是否过期或权限不足。
- 如果 Homebrew 提示 sha256 不匹配，重新跑一次 main 分支的 Actions，或检查 Release DMG 是否被手动替换过。
