# Release Workflow

本文记录当前 macOS DMG 发版、GitHub Release 和 Homebrew tap 同步流程，供后续 agent 维护自动化时查询。

## 目标

- 非 main 分支 push / PR：只构建 macOS DMG 并上传 workflow artifact。
- main 分支 push：构建 DMG，创建或更新 GitHub Release，并同步 `wmasfoe/homebrew-tap` 的 cask。
- Release 版本号以 `apps/desktop/src-tauri/tauri.conf.json` 的 `version` 为准，并要求 root package、desktop package、Cargo manifest 与它一致。

## 相关文件

- `.github/workflows/build-macos.yml`: CI、Release、Homebrew tap 同步入口。
- `scripts/release/version-desktop.mjs`: 同步更新 root package、desktop package、Tauri config、Cargo manifest 和 Cargo lock 的版本号。
- `scripts/release/write-homebrew-cask.mjs`: 根据 DMG 文件名、sha256 和版本生成 `Casks/md-editor.rb`。
- `apps/desktop/src-tauri/tauri.conf.json`: Tauri app 版本号源头。

## 一次发版步骤

1. 更新版本号：

   ```bash
   pnpm release:version patch
   ```

   也可以使用 `minor`、`major` 或显式版本号，例如 `pnpm release:version 0.2.0`。

2. 提交版本文件和代码改动。

3. push 到 `main`。

4. GitHub Actions 会自动：
   - 安装 pnpm / Node / Rust。
   - 执行 `pnpm build:macos` 构建 DMG。
   - 读取并校验版本一致性。
   - 上传 DMG workflow artifact。
   - 创建或更新 `v{version}` GitHub Release。
   - 计算 DMG `sha256`。
   - clone `wmasfoe/homebrew-tap`。
   - 生成并提交 `Casks/md-editor.rb`。

## 必需 Secret

`md-editor` 仓库需要配置：

- `HOMEBREW_TAP_TOKEN`

该 token 用于写入 `wmasfoe/homebrew-tap`。推荐 fine-grained PAT：

- Repository access: `wmasfoe/homebrew-tap`
- Permissions:
  - Contents: Read and write
  - Metadata: Read

当前仓库的 Release 创建使用 `github.token`，不需要额外 secret。

## Release 行为

main push 时使用 `v{version}` 作为 Release tag。

- 如果 Release 不存在：`gh release create` 创建 Release 并上传 DMG。
- 如果 Release 已存在：`gh release upload --clobber` 覆盖上传 DMG，避免同名 tag 报错。

## Homebrew cask 行为

生成的 cask 位于 tap 仓库：

```text
Casks/md-editor.rb
```

下载 URL 形如：

```ruby
url "https://github.com/wmasfoe/md-editor/releases/download/v#{version}/Markdown%20Editor_#{version}_aarch64.dmg"
```

安装命令：

```bash
brew install --cask wmasfoe/tap/md-editor
```

## 常见问题

- Release 步骤被跳过：确认触发事件是 push 到 `refs/heads/main`。PR、非 main 分支和手动 workflow 只构建，不发 Release。
- `a release with the same tag name already exists`：当前 workflow 应该使用 `gh release upload --clobber` 处理已存在 Release；若再次出现，检查 workflow 是否是最新版本。
- tap 更新失败：优先检查 `HOMEBREW_TAP_TOKEN` 是否存在、是否有 `wmasfoe/homebrew-tap` 的 Contents write 权限。
- Homebrew 安装失败且提示 sha256 不匹配：检查 Release 里的 DMG 是否被重新上传但 tap 未更新，或 workflow 是否在 Release 上传后才计算 sha256。
