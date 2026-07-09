# Release Workflow

本文记录当前 macOS DMG 发版、GitHub Release 和 Homebrew tap 同步流程，供后续 agent 维护自动化时查询。

## 目标

- PR：由 `.github/workflows/build-macos.yml` 执行 lint、typecheck、test、Rust test 和版本一致性校验，不默认构建 DMG。
- 手动触发 `.github/workflows/build-macos.yml`：执行同样校验后构建 macOS DMG，并上传 workflow artifact。普通构建不生成 updater artifact，因此不依赖 Tauri updater 私钥。
- `v*` tag push：由 `.github/workflows/release-macos.yml` 先校验版本、tag 和 updater signing secret，再执行校验与 release-only 构建；release 构建会先生成 DMG，再单独生成 signed updater artifact。校验通过后创建或更新 GitHub Release。stable 版本继续把 DMG 和 signed updater artifact 复制到公开 `wmasfoe/homebrew-tap` Release，并同步 tap cask、`curl | sh` 安装脚本和 `md-editor-latest.json` 应用内更新 manifest；beta / prerelease 版本只保留 GitHub prerelease，不发布到 Homebrew tap。app 发布成功后，workflow 会通过共享的 `pnpm deploy:site` 入口发布官网 changelog。
- main 分支 push 不发 Release。Release 和 Homebrew 同步只允许由 `v*` tag 触发。
- Release 版本号以 `apps/desktop/src-tauri/tauri.conf.json` 的 `version` 为准，并要求 root package、desktop package、Cargo manifest 与它一致。
- tag 名必须匹配版本号生成的 `v{version}`，例如版本 `0.2.1` 必须推送 `v0.2.1`。

## 相关文件

- `.github/workflows/build-macos.yml`: PR 和手动触发的 macOS 校验构建入口。
- `.github/workflows/release-macos.yml`: `v*` tag 触发的 GitHub Release 和 Homebrew tap 同步入口。
- `scripts/release/publish-desktop.mjs`: 交互式发版编排脚本，负责版本同步、commit、tag 和 push。
- `scripts/release/changelog.mjs`: `CHANGELOG.md` 更新规则，普通发版新增目标版本 section，`--resume` 复用已存在 section，禁止重复或静默覆盖。
- `scripts/site/deploy-site.mjs`: 官网唯一 Vercel CLI 发布入口；本地 `pnpm deploy:site` 和 release workflow 都通过它发布。
- `scripts/release/version-desktop.mjs`: 同步更新 root package、desktop package、Tauri config、Cargo manifest 和 Cargo lock 的版本号。
- `scripts/release/write-homebrew-cask.mjs`: 根据 DMG 文件名、sha256 和版本生成 `Casks/md-editor.rb`。
- `scripts/release/write-install-script.mjs`: 根据公开 DMG 下载地址、sha256 和版本生成 `install-md-editor.sh`，供用户通过 curl 直接安装。
- `scripts/release/write-updater-manifest.mjs`: 根据公开 updater artifact URL、签名和平台 key 生成 `md-editor-latest.json`。
- `package.json`: `build:macos:release` 顺序调用 `build:macos:release:dmg` 和 `build:macos:release:updater`，避免 DMG 和 app updater artifact 在同一轮 Tauri build 中互相影响。
- `CHANGELOG.md`: 官网 changelog 的人可读主源，发版脚本会把本次 release notes 写入这里。
- `apps/desktop/src-tauri/tauri.conf.json`: Tauri app 版本号源头，并配置 updater 公钥和 manifest endpoint。
- `apps/desktop/src-tauri/tauri.release.conf.json`: release-only Tauri 配置，只在 tag release 构建中打开 `bundle.createUpdaterArtifacts`。

## 一次发版步骤

1. 推荐运行交互式发版脚本：

   ```bash
   pnpm release
   ```

   脚本会要求当前分支默认是 `main` 且工作区干净，然后引导选择 `patch`、`minor`、`major`、`beta` 或具体版本号，输入更新内容，自动同步版本文件、创建 Lore commit、创建 tag，并 push 分支和 tag。

   发版脚本还会更新根目录 `CHANGELOG.md`。普通发版会新增一个目标版本 section；如果该版本 section 已存在，脚本会失败，避免重复 changelog。`--resume` 只用于部分发版重试，并要求目标版本 section 已经存在且保持不变。

   可用 `pnpm release patch --dry-run` 预览，也可用 `--notes` 传入更新内容。如果脚本在版本文件更新后中断，可用 `pnpm release --resume` 跳过 `release:version`，直接用当前版本文件继续 commit、tag 和 push。

2. 如需手动更新版本号：

   ```bash
   pnpm release:version patch
   ```

   也可以使用 `minor`、`major` 或显式版本号，例如 `pnpm release:version 0.2.0`。

3. 提交版本文件和代码改动。

4. push 到 `main`。如需在打 tag 前额外确认构建产物，可手动触发 `Build macOS App` workflow。

5. 创建并推送与版本号匹配的 tag：

   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```

6. GitHub Actions 会自动：
   - 读取并校验版本一致性。
   - 校验 tag 名等于 `v{version}`。
   - 校验 `TAURI_SIGNING_PRIVATE_KEY` 已配置。
   - 安装 pnpm / Node / Rust，并恢复 pnpm / Cargo 缓存。
   - 执行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:rust`。
   - 执行 `pnpm build:macos:release`；该脚本先用 `build:macos:release:dmg` 构建 DMG，再用 `build:macos:release:updater` 构建 `.app.tar.gz` updater artifact 和 `.sig`。
   - 上传 DMG 和 updater workflow artifact。
   - 创建或更新 `v{version}` GitHub Release，并上传 DMG、updater artifact 和签名。
   - 计算 DMG `sha256`。
   - 读取 updater artifact 平台 key 和 `.sig` 文件内容。
   - clone `wmasfoe/homebrew-tap`。
   - 创建或更新 `wmasfoe/homebrew-tap` 中的 `md-editor-v{version}` Release，并上传 DMG、updater artifact 和签名。
   - 读取公开 tap Release 中真实 DMG 和 updater asset URL。
   - 生成并提交 `Casks/md-editor.rb`。
   - 生成并提交 `install-md-editor.sh`。
   - 生成并提交 `md-editor-latest.json`。
   - 通过 `pnpm deploy:site` 构建并发布官网，使公开 changelog 同步到本次 app release。

## 必需 Secret

`md-editor` 仓库需要配置：

- `HOMEBREW_TAP_TOKEN`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，仅当 updater 私钥设置了密码时需要。
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

`HOMEBREW_TAP_TOKEN` 用于写入 `wmasfoe/homebrew-tap` 的 cask 文件、curl 安装脚本、updater manifest 和公开 Release asset。推荐 fine-grained PAT：

- Repository access: `wmasfoe/homebrew-tap`
- Permissions:
  - Contents: Read and write
  - Metadata: Read

`TAURI_SIGNING_PRIVATE_KEY` 是 Tauri updater 私钥内容，用于签 `.app.tar.gz` 更新包。它和 Apple Developer ID 证书无关；当前没有 Apple Developer 签名时，release workflow 仍使用 `signingIdentity: "-"` 做 macOS ad-hoc signing。不要提交私钥文件或把私钥写进文档。

当前仓库的 GitHub Release 创建使用 `github.token`，不需要额外 secret。

`VERCEL_*` secrets 仅用于官网发布。官网项目必须使用 CLI-only 发布；不要启用 Vercel Git 自动部署、PR preview 或 main push production deploy。release workflow 和本地发布都必须通过 `pnpm deploy:site` 调用 `scripts/site/deploy-site.mjs`。

## 官网发布行为

官网位于根目录 `site/`，是独立 pnpm workspace 包。常用命令：

```bash
pnpm dev:site
pnpm build:site
pnpm deploy:site
```

`pnpm deploy:site` 是唯一允许调用 Vercel CLI 的仓库入口。它会先构建官网，再执行 production deploy。本地运行时可使用本机 Vercel 登录状态；CI 中必须提供 `VERCEL_TOKEN`、`VERCEL_ORG_ID` 和 `VERCEL_PROJECT_ID`。

PR 不创建 Vercel preview。普通 `main` push 不发布官网。app release 成功后会自动运行 `pnpm deploy:site` 发布最新 changelog。如果 app artifact 已发布但官网部署失败，app release 仍然有效；此时官网 changelog 可能暂时落后，可在 release commit/tag checkout 上重新运行 `pnpm deploy:site`，或重跑失败的 workflow。

## Release 行为

`v*` tag push 时使用当前 tag 作为 Release tag，并要求它等于项目版本生成的 `v{version}`。

- 如果 Release 不存在：`gh release create` 创建 Release 并上传 DMG、updater artifact 和签名。
- 如果 Release 已存在：`gh release upload --clobber` 覆盖上传 DMG、updater artifact 和签名，避免同名 tag 报错。
- 如果版本号包含 prerelease 后缀，例如 `0.2.2-beta.1`，GitHub Release 会标记为 prerelease，并跳过所有 Homebrew tap 步骤。

源码仓库是私有仓库时，Homebrew 和 Tauri updater 都无法匿名下载 `wmasfoe/md-editor` 的 Release asset，GitHub 会返回 404。因此 stable release workflow 还会把同一个 DMG、updater artifact 和签名上传到公开 tap 仓库：

```text
wmasfoe/homebrew-tap releases md-editor-v{version}
```

cask 和 updater manifest 的下载 URL 指向这个公开 Release 中真实的 `browser_download_url`。不要用本地文件名手动拼下载地址，因为 GitHub Release asset 可能会规范化文件名，例如把空格显示为点。

## 应用内更新行为

桌面端设置页使用 Tauri updater 插件检查 `https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/md-editor-latest.json`。默认版本比较只会在 manifest 版本大于当前 app 版本时返回可安装更新，因此不会重复安装当前版本或降级。

stable release workflow 会生成并提交：

```text
md-editor-latest.json
```

manifest 内容包含：

- `version`: 当前 stable 版本。
- `platforms.{darwin-aarch64|darwin-x86_64}.url`: 公开 tap Release 里的 `.app.tar.gz` 下载地址。
- `platforms.{platform}.signature`: Tauri 生成的 `.sig` 文件内容。

如果 updater manifest 尚未发布、网络不可用或签名配置异常，设置页会回退到现有 GitHub Release 检查，并展示手动 `curl | sh` 安装命令。

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

- Release 步骤被跳过：确认触发事件是 push 到 `refs/tags/v*`。PR 只校验，不发 Release；手动 `Build macOS App` workflow 会校验并上传 DMG artifact，但也不会发 Release。
- tag 校验失败：确认 tag 名等于项目版本号。例如 `tauri.conf.json` 是 `0.2.1` 时，必须推送 `v0.2.1`。
- `a release with the same tag name already exists`：当前 workflow 应该使用 `gh release upload --clobber` 处理已存在 Release；若再次出现，检查 workflow 是否是最新版本。
- tap 更新失败：优先检查 `HOMEBREW_TAP_TOKEN` 是否存在、是否有 `wmasfoe/homebrew-tap` 的 Contents write 权限。
- Release 构建提示缺少 `TAURI_SIGNING_PRIVATE_KEY`：把 Tauri updater 私钥内容配置为同名 GitHub Secret。没有 Apple Developer 证书不影响 updater 签名，但没有 updater 私钥会导致 release-only updater artifact 无法生成。
- tap 日志显示 `Wrote homebrew-tap/Casks/md-editor.rb` 后又提示已经 up to date：检查 workflow 是否先 `git add Casks/md-editor.rb install-md-editor.sh md-editor-latest.json` 再用 `git diff --cached --quiet` 判断变化；未跟踪的新文件不会被普通 `git diff --quiet` 检测到。
- `brew install` 下载 DMG 时 404：如果 `md-editor` 仓库是私有仓库，cask 不能指向 `wmasfoe/md-editor` Release asset，应指向公开 `wmasfoe/homebrew-tap` 的 `md-editor-v{version}` Release asset。
- `curl` 安装脚本 404：确认最近一次 stable release workflow 已成功提交 `install-md-editor.sh` 到 `wmasfoe/homebrew-tap` 的 `main` 分支；beta / prerelease 不会更新该脚本。
- 应用内检查更新不可用：确认最近一次 stable release workflow 已成功提交 `md-editor-latest.json` 到 `wmasfoe/homebrew-tap` 的 `main` 分支，且公开 tap Release 里存在 `.app.tar.gz` 和 `.app.tar.gz.sig`。
- cask URL 和 Release 页面里的 DMG 文件名不一致：以 GitHub Release API 返回的 `browser_download_url` 为准，不要从本地文件名推导。
- Homebrew 安装失败且提示 sha256 不匹配：检查 Release 里的 DMG 是否被重新上传但 tap 未更新，或 workflow 是否在 Release 上传后才计算 sha256。
