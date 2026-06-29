# Release Workflow

本文记录当前 macOS DMG 发版、GitHub Release 和 Homebrew tap 同步流程，供后续 agent 维护自动化时查询。

## 目标

- 分支 push / PR / 手动触发：由 `.github/workflows/build-macos.yml` 执行 lint、typecheck、test，构建 macOS DMG，并上传 workflow artifact。
- `v*` tag push：由 `.github/workflows/release-macos.yml` 执行同样的校验和 DMG 构建；校验通过后创建或更新 GitHub Release。stable 版本继续把 DMG 复制到公开 `wmasfoe/homebrew-tap` Release，并同步 tap cask 与 `curl | sh` 安装脚本；beta / prerelease 版本只保留 GitHub prerelease，不发布到 Homebrew tap。
- main 分支 push 不发 Release。Release 和 Homebrew 同步只允许由 `v*` tag 触发。
- Release 版本号以 `apps/desktop/src-tauri/tauri.conf.json` 的 `version` 为准，并要求 root package、desktop package、Cargo manifest 与它一致。
- tag 名必须匹配版本号生成的 `v{version}`，例如版本 `0.2.1` 必须推送 `v0.2.1`。

## 相关文件

- `.github/workflows/build-macos.yml`: 分支、PR 和手动触发的 macOS 校验构建入口。
- `.github/workflows/release-macos.yml`: `v*` tag 触发的 GitHub Release 和 Homebrew tap 同步入口。
- `scripts/release/publish-desktop.mjs`: 交互式发版编排脚本，负责版本同步、commit、tag 和 push。
- `scripts/release/version-desktop.mjs`: 同步更新 root package、desktop package、Tauri config、Cargo manifest 和 Cargo lock 的版本号。
- `scripts/release/write-homebrew-cask.mjs`: 根据 DMG 文件名、sha256 和版本生成 `Casks/md-editor.rb`。
- `scripts/release/write-install-script.mjs`: 根据公开 DMG 下载地址、sha256 和版本生成 `install-md-editor.sh`，供用户通过 curl 直接安装。
- `apps/desktop/src-tauri/tauri.conf.json`: Tauri app 版本号源头。

## 一次发版步骤

1. 推荐运行交互式发版脚本：

   ```bash
   pnpm release
   ```

   脚本会要求当前分支默认是 `main` 且工作区干净，然后引导选择 `patch`、`minor`、`major`、`beta` 或具体版本号，输入更新内容，自动同步版本文件、创建 Lore commit、创建 tag，并 push 分支和 tag。

   可用 `pnpm release patch --dry-run` 预览，也可用 `--notes` 传入更新内容。如果脚本在版本文件更新后中断，可用 `pnpm release --resume` 跳过 `release:version`，直接用当前版本文件继续 commit、tag 和 push。

2. 如需手动更新版本号：

   ```bash
   pnpm release:version patch
   ```

   也可以使用 `minor`、`major` 或显式版本号，例如 `pnpm release:version 0.2.0`。

3. 提交版本文件和代码改动。

4. push 到 `main`，等待分支校验通过。

5. 创建并推送与版本号匹配的 tag：

   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```

6. GitHub Actions 会自动：
   - 安装 pnpm / Node / Rust。
   - 执行 `pnpm lint`、`pnpm typecheck` 和 `pnpm test`。
   - 读取并校验版本一致性。
   - 校验 tag 名等于 `v{version}`。
   - 执行 `pnpm build:macos` 构建 DMG。
   - 上传 DMG workflow artifact。
   - 创建或更新 `v{version}` GitHub Release。
   - 计算 DMG `sha256`。
   - clone `wmasfoe/homebrew-tap`。
   - 创建或更新 `wmasfoe/homebrew-tap` 中的 `md-editor-v{version}` Release，并上传 DMG。
   - 读取公开 tap Release 中真实 DMG asset URL。
   - 生成并提交 `Casks/md-editor.rb`。
   - 生成并提交 `install-md-editor.sh`。

## 必需 Secret

`md-editor` 仓库需要配置：

- `HOMEBREW_TAP_TOKEN`

该 token 用于写入 `wmasfoe/homebrew-tap` 的 cask 文件和公开 Release asset。推荐 fine-grained PAT：

- Repository access: `wmasfoe/homebrew-tap`
- Permissions:
  - Contents: Read and write
  - Metadata: Read

当前仓库的 Release 创建使用 `github.token`，不需要额外 secret。

## Release 行为

`v*` tag push 时使用当前 tag 作为 Release tag，并要求它等于项目版本生成的 `v{version}`。

- 如果 Release 不存在：`gh release create` 创建 Release 并上传 DMG。
- 如果 Release 已存在：`gh release upload --clobber` 覆盖上传 DMG，避免同名 tag 报错。
- 如果版本号包含 prerelease 后缀，例如 `0.2.2-beta.1`，GitHub Release 会标记为 prerelease，并跳过所有 Homebrew tap 步骤。

源码仓库是私有仓库时，Homebrew 无法匿名下载 `wmasfoe/md-editor` 的 Release asset，GitHub 会返回 404。因此 stable release workflow 还会把同一个 DMG 上传到公开 tap 仓库：

```text
wmasfoe/homebrew-tap releases md-editor-v{version}
```

cask 的下载 URL 指向这个公开 Release 中真实的 `browser_download_url`。不要用本地 DMG 文件名手动拼下载地址，因为 GitHub Release asset 可能会规范化文件名，例如把空格显示为点。

## Homebrew cask 行为

生成的 cask 位于 tap 仓库：

```text
Casks/md-editor.rb
```

Beta / prerelease 版本不会生成或更新 Homebrew cask。

下载 URL 形如：

```ruby
url "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v#{version}/Markdown.Editor_#{version}_aarch64.dmg"
```

安装命令：

```bash
brew install --cask wmasfoe/tap/md-editor
```

## curl 安装脚本行为

stable release workflow 会在公开 tap 仓库根目录生成：

```text
install-md-editor.sh
```

用户安装命令：

```bash
curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh
```

脚本内写死本次 stable release 的公开 DMG 下载地址和 sha256。执行时会：

1. 只允许在 macOS 执行。
2. 用 `curl` 下载公开 tap Release 中的 DMG。
3. 用 `shasum -a 256` 校验 DMG。
4. 挂载 DMG，复制 `Markdown Editor.app` 到 `/Applications`。
5. 默认移除 `com.apple.quarantine`，避免未签名/未公证 DMG 下载安装后直接被 Gatekeeper 拦截；如需保留隔离标记，可设置 `MD_EDITOR_KEEP_QUARANTINE=1`。

可选环境变量：

- `MD_EDITOR_INSTALL_DIR`: 覆盖安装目录，默认 `/Applications`。
- `MD_EDITOR_KEEP_DMG=1`: 调试时保留下载的 DMG 临时文件。

## 常见问题

- Release 步骤被跳过：确认触发事件是 push 到 `refs/tags/v*`。PR、分支 push 和手动 workflow 只校验、构建并上传 artifact，不发 Release。
- tag 校验失败：确认 tag 名等于项目版本号。例如 `tauri.conf.json` 是 `0.2.1` 时，必须推送 `v0.2.1`。
- `a release with the same tag name already exists`：当前 workflow 应该使用 `gh release upload --clobber` 处理已存在 Release；若再次出现，检查 workflow 是否是最新版本。
- tap 更新失败：优先检查 `HOMEBREW_TAP_TOKEN` 是否存在、是否有 `wmasfoe/homebrew-tap` 的 Contents write 权限。
- tap 日志显示 `Wrote homebrew-tap/Casks/md-editor.rb` 后又提示 `Homebrew cask is already up to date.`：检查 workflow 是否先 `git add Casks/md-editor.rb` 再用 `git diff --cached --quiet` 判断变化；未跟踪的新文件不会被普通 `git diff --quiet` 检测到。
- `brew install` 下载 DMG 时 404：如果 `md-editor` 仓库是私有仓库，cask 不能指向 `wmasfoe/md-editor` Release asset，应指向公开 `wmasfoe/homebrew-tap` 的 `md-editor-v{version}` Release asset。
- `curl` 安装脚本 404：确认最近一次 stable release workflow 已成功提交 `install-md-editor.sh` 到 `wmasfoe/homebrew-tap` 的 `main` 分支；beta / prerelease 不会更新该脚本。
- cask URL 和 Release 页面里的 DMG 文件名不一致：以 GitHub Release API 返回的 `browser_download_url` 为准，不要从本地文件名推导。
- Homebrew 安装失败且提示 sha256 不匹配：检查 Release 里的 DMG 是否被重新上传但 tap 未更新，或 workflow 是否在 Release 上传后才计算 sha256。
