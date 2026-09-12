# Release Workflow

本文记录当前桌面端（macOS / Linux / Windows）、Web 在线端（Playground）、uTools 插件与官网（Site）的发版、GitHub Release 和持续交付流程，供后续 agent 维护自动化时查询。

## 目标与路由契约

- **PR**：由 `.github/workflows/build-desktop.yml`、`build-site.yml` 与 `release-utools.yml` 执行各自范围的 lint、typecheck、test、构建或版本一致性校验；uTools workflow 会保留短期发布目录产物。
- **Desktop 发版（`v*` tag）**：
  - 由 `.github/workflows/release-desktop.yml` 先校验版本、tag 和 updater signing secret，再执行校验与 release-only 构建；
  - macOS 构建 DMG 及 signed updater artifact，Linux 构建 AppImage 与 DEB，Windows 构建 NSIS EXE；
  - 校验通过后创建或更新 GitHub Release；
  - stable 版本继续把产物同步到公开 `wmasfoe/homebrew-tap` Release，并同步 tap cask、安装脚本和应用内更新 manifest；
  - desktop 发布成功后，workflow 会通过 `pnpm release:site` 自动触发官网 changelog 发布。
- **Web 发版（`web-v*` tag）**：
  - 由 `.github/workflows/release-web.yml` 触发；
  - 校验 `apps/web` 类型检查与单元测试，执行 `pnpm build:web`；
  - 将产物压缩为 `md-editor-web-${version}.zip` 并创建对应 GitHub Release。
- **uTools 发版（`utools-v*` tag）**：
  - 由 `.github/workflows/release-utools.yml` 触发，首发版本为 `0.1.0`；
  - 校验 package、源码/构建 plugin manifest 与 tag 版本完全一致，并拒绝包含开发地址或缺少关键文件的产物；
  - 上传 `inkpoint-utools-${version}.zip` 并创建 GitHub Release；
  - uTools 市场没有公开发布 API/CLI，版本说明、截图、提交审核仍由维护者在官方开发者工具中完成。
- **官网部署**：
  - 唯一入口为 `pnpm release:site`（`scripts/site/deploy-site.mjs`）；
  - 聚合读取 `apps/desktop/CHANGELOG.md` 与 `apps/web/CHANGELOG.md`，并在页面以多 Tab 方式展示。

## 核心发版命令速查

| 命令 | 对应脚本 | 说明 |
| :--- | :--- | :--- |
| `pnpm release:desktop` | `scripts/release/publish-desktop.mjs` | 桌面端完整发版流程（版本更新、Changelog 写入、commit、`v*` tag 与 push，同时支持 `desktop-v*`） |
| `pnpm release:desktop:version` | `scripts/release/version-desktop.mjs` | 仅更新桌面端核心版本文件（desktop package, Tauri, Cargo；root package 固定为 `0.0.0` 容器占位）与 `apps/desktop/CHANGELOG.md` |
| `pnpm release:web` | `scripts/release/publish-web.mjs` | Web 端完整发版流程（版本更新、`apps/web/CHANGELOG.md` 写入、构建自检、commit、`web-v*` tag 与 push） |
| `pnpm release:web:version` | `scripts/release/version-web.mjs` | 仅更新 Web 端版本文件与 `apps/web/CHANGELOG.md` |
| `pnpm release:site` | `scripts/site/deploy-site.mjs` | 官网 Vercel CLI 预构建发布入口 |

## 相关文件索引

- `.github/workflows/build-desktop.yml`: PR 和手动触发的跨平台校验构建入口。
- `.github/workflows/release-desktop.yml`: `v*` / `desktop-v*` tag 触发的桌面端 GitHub Release 和 Homebrew tap 同步入口。
- `.github/workflows/release-web.yml`: `web-v*` tag 触发的 Web 端 GitHub Release 工作流。
- `.github/workflows/release-utools.yml`: uTools PR 构建产物和 `utools-v*` tag GitHub Release 工作流。
- `.github/workflows/release-beta.yml`: `beta` 分支 push 触发的桌面端 beta 预发布构建入口。
- `scripts/release/version-desktop.mjs`: 同步更新 desktop package、Tauri config、Cargo manifest 的版本号（root package 保持 `0.0.0` 容器占位），并更新 `apps/desktop/CHANGELOG.md`。
- `scripts/release/publish-desktop.mjs`: 交互式桌面端发版编排脚本。
- `scripts/release/version-web.mjs`: 更新 `apps/web/package.json` 与 `apps/web/CHANGELOG.md`。
- `scripts/release/publish-web.mjs`: 交互式 Web 端发版编排脚本。
- `scripts/release/validate-utools-release.mjs`: 校验 uTools 版本、tag、正式 manifest 和构建目录完整性。
- `scripts/release/changelog.mjs`: Changelog 解析与更新共享工具模块。
- `scripts/site/deploy-site.mjs`: 官网唯一 Vercel CLI 发布入口；由 `pnpm release:site` 触发。
- `apps/desktop/CHANGELOG.md`: 桌面端更新历史。
- `apps/web/CHANGELOG.md`: Web 在线端更新历史。
- `apps/utools/CHANGELOG.md`: uTools 插件更新历史。

## 必需 Secret

`md-editor` 仓库需要配置：
- `HOMEBREW_TAP_TOKEN`: 写入公开 `wmasfoe/homebrew-tap` 的 cask 文件、安装脚本、updater manifest。
- `TAURI_SIGNING_PRIVATE_KEY`: 签名应用内更新包。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 仅当私钥设置了密码时需要。
- `VERCEL_TOKEN`: 官网 CLI 部署。
- `VERCEL_ORG_ID`: 官网目标 Org ID。
- `VERCEL_PROJECT_ID`: 官网目标 Project ID。
