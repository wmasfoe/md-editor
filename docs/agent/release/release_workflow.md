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
- **Web 发版（方案 A：Vercel CLI 预构建发布）**：
  - 核心入口为 `pnpm release:web`（`scripts/web/deploy-web.mjs`）；
  - `apps/web/vercel.json` 显式设置 `"git": { "deploymentEnabled": false }`，关闭 PR 合并与 push 触发的自动部署；
  - 本地运行直接通过 Vercel CLI 执行 `pull` -> `build --prod` -> `deploy --prebuilt` 极速上线生产环境；
  - **绝不创建 GitHub Release**，保持 GitHub Releases 页面专用于桌面客户端安装包，确保仓库主页 `Latest` 徽标永远锁定在桌面客户端；
  - 版本号与日志由 `apps/web/package.json` 与 `apps/web/CHANGELOG.md` 维护，官网更新记录页以多 Tab 独立呈现；
  - 若推送 `web-v*` 标签，CI 仅执行校验与 Vercel 备份部署，不生成 Release 压缩包。
- **uTools 发版（`utools-v*` tag）**：
  - 由 `.github/workflows/release-utools.yml` 触发，首发版本为 `0.1.0`；
  - 校验 package、源码/构建 plugin manifest 与 tag 版本完全一致，并拒绝包含开发地址或缺少关键文件的产物；
  - 上传 `inkpoint-utools-${version}.zip` 并创建 GitHub Release；
  - uTools 市场没有公开发布 API/CLI，版本说明、截图、提交审核仍由维护者在官方开发者工具中完成。
- **移动端（Android / iOS）不再发版**：
  - 已删除 `release-mobile.yml`、`build-ios-ipa.yml`、`mobile-ci.yml`，以及 `release:android*` / `release:ios*` 命令和对应的版本脚本；
  - 已发布的最后一个版本（Android 0.2.1、iOS 0.2.1）仍保留在 R2，`/inkpoint/android/...`、`/inkpoint/ios/<version>/...` 的直链继续可用，官网下载面板指向这两个版本；
  - 历史条目只靠线上 `releases.json` 保留：`sync-r2-releases-manifest.mjs` 不再从 git tag 或环境变量生成移动端条目，只把线上清单里已有的移动端条目原样带过去；
  - 需要新的安装包时在本机编译：`pnpm build:android`、`pnpm build:ios`（见 `scripts/mobile/`）。
- **官网部署**：
  - 唯一入口为 `pnpm release:site`（`scripts/site/deploy-site.mjs`）；
  - `apps/site/vercel.json` 显式设置 `"git": { "deploymentEnabled": false }`；
  - 承载主站首页、Next.js ISR 全平台版本分发中心（`/releases`）、更新日志（`/changelog`）等；
  - 对应主域名：`editor.jiaqi.im`（历史域名 `editor.justdev.cn` 自动重定向至此）。
- **全球边缘分发网关与 R2 存储（Cloudflare Worker）**：
  - 唯一入口为 `pnpm deploy:worker`（`infra/distribution-worker`）；
  - 负责各平台安装包大文件直连（`/inkpoint/desktop/...`、`/inkpoint/android/...`）、版本清单 API（`/api/inkpoint/releases`）、应用内自动更新检查（`/desktop/updater.json`）与静态目录预渲染；
  - 对应主域名：`download.jiaqi.im`（历史域名 `download.justdev.cn` 自动重定向至此）。

## 核心发版与部署命令速查

| 命令 | 对应脚本 / 目录 | 说明 |
| :--- | :--- | :--- |
| `pnpm release:desktop` | `scripts/release/publish-desktop.mjs` | 桌面端完整发版流程（版本更新、Changelog 写入、commit、`v*` tag 与 push，同时支持 `desktop-v*`） |
| `pnpm release:desktop:version` | `scripts/release/version-desktop.mjs` | 仅更新桌面端核心版本文件（desktop package, Tauri, Cargo；root package 固定为 `0.0.0` 容器占位）与 `apps/desktop/CHANGELOG.md` |
| `pnpm build:android` | `scripts/mobile/build-android-apk.mjs` | 本机编出 `dist-mobile/Inkpoint_<version>.apk`（Debug 签名，需 JDK 17 与 Android SDK） |
| `pnpm build:ios` | `scripts/mobile/build-ios-ipa.mjs` | 本机编出 `dist-mobile/Inkpoint-<version>-unsigned.ipa`（未签名，需 macOS 与 Xcode） |
| `pnpm release:web` | `scripts/web/deploy-web.mjs` | Web 端本地 Vercel CLI 预构建极速上线入口（对标 `release:site`） |
| `pnpm release:web:version` | `scripts/release/version-web.mjs` | 仅更新 Web 端版本文件与 `apps/web/CHANGELOG.md` |
| `pnpm deploy:web` | `scripts/web/deploy-web.mjs` | Web 端部署别名入口 |
| `pnpm release:site` | `scripts/site/deploy-site.mjs` | 官网 Vercel CLI 预构建发布入口（发布至 `editor.jiaqi.im`） |
| `pnpm deploy:worker` | `infra/distribution-worker` | Cloudflare Worker 边缘分发网关发布入口（发布至 `download.jiaqi.im`） |
| `pnpm dev:site` | `site` | 本地启动官网 Next.js 开发环境（端口 3000） |
| `pnpm dev:worker` | `infra/distribution-worker` | 本地启动 Cloudflare Worker 边缘网关调试环境（Wrangler） |

## 下载中心历史版本清单（`inkpoint/releases.json`）契约

下载中心的版本列表**不是**扫 R2 目录得到的，而是读 R2 里的预构建清单 `inkpoint/releases.json`；
Worker 优先用该清单，只有清单缺失/为空时才回退到 GitHub Releases API，最后才用仓库内置的
`infra/distribution-worker/src/fallback-releases.json`。清单由
`scripts/release/sync-r2-releases-manifest.mjs` 生成并在发版时 `--upload` 覆盖。

因此有两个必须守住的契约：

1. **生成清单必须能读到 GitHub Releases**（桌面端条目唯一来源）：
   - CI 里必须把 `GITHUB_TOKEN` / `GH_TOKEN` 传给同步步骤（三个 workflow 的 R2 上传步骤已显式传入）。
     不带 token 时匿名调用 `api.github.com` 会被 **403 限流**；
   - 本地运行时脚本会用 `gh auth token` 兜底，未登录时同样会降级。
2. **任何降级都不得缩小历史**：
   - 历史桌面端条目会从「线上清单 ∪ 仓库 fallback」合并补齐（并清洗 `utools-v*` 这类非发行 tag 脏数据）；
   - 生成后有一道护栏 `evaluateReleaseHistoryShrink`：桌面端 / 移动端去重版本数少于基线时，
     **跳过写入与上传**并打印原因（线上清单保持原样）；确需主动下架版本时用
     `--allow-history-shrink` 或 `ALLOW_RELEASE_HISTORY_SHRINK=true` 显式放行。

### 事故复盘（2026-10-17：下载中心 desktop 只剩最新版）

- 现象：`/inkpoint/desktop/` 只列 `0.13.1`，但 R2 里的历史安装包都还在。
- 根因链：`release-desktop.yml` 的同步步骤未传 `GITHUB_TOKEN` → `api.github.com` 返回 **403** →
  脚本把「拉取失败」当成「历史上只有这些版本」（当时桌面端条目只来自 GitHub，且不合并历史）→
  仍以 `--upload` 覆写 R2 清单 → 桌面端条目归零，页面仅剩 Worker 从 `version.json` 补出的当前版本。
  证据：该次 Release Desktop App run 日志中 `GitHub API releases page 1 returned HTTP 403` +
  `✓ Fetched 0 releases from GitHub` + `✅ Successfully uploaded inkpoint/releases.json to R2!`。
- 已修：CI 传 token；桌面端历史合并；护栏 fail-closed；`fallback-releases.json` 重新生成（补齐 0.10.3–0.13.1）。

### 修复手册（清单被截断时）

```bash
# 1) 本地（已 gh auth login）重新生成清单：会打印护栏结论，历史不足会拒绝写盘
node scripts/release/sync-r2-releases-manifest.mjs

# 2) 确认条目数/版本范围正常后，再上传到 R2 并刷边缘缓存
node scripts/release/sync-r2-releases-manifest.mjs --upload
node scripts/release/purge-download-cache.mjs

# 3) 线上校验（应能看到完整历史，而不是 1 条桌面版本）
curl -s https://download.jiaqi.im/api/inkpoint/releases | head -c 400
```

### 应用内更新 manifest 契约（全平台）

- 唯一生成器：`scripts/release/write-r2-updater-manifest.mjs`。R2 `inkpoint/desktop/updater.json` 与
  tap `md-editor-latest.json`（客户端第二 endpoint）由同一次调用生成，平台条目一致，只是下载地址前缀不同；
  平台匹配规则集中在该脚本的 `UPDATER_PLATFORMS`，新增平台只改这一处。
- 平台键遵循 tauri-plugin-updater 的查找顺序（先 `{os}-{arch}-{installer}`，再 `{os}-{arch}`）：
  - macOS：`darwin-aarch64`（+`-app`），产物 `*.app.tar.gz`；Intel 产物名需带 `x64`/`x86_64` 才会进 `darwin-x86_64`；
  - Windows：`windows-x86_64`（+`-nsis`），产物按 `.nsis.zip` → `*.zip` → `*-x64-setup.exe` 优先级解析；
  - Linux：`linux-{x86_64,aarch64}`（+`-appimage`）指向 AppImage，`linux-{x86_64,aarch64}-deb` 指向 deb。
    **deb 键必须存在**：否则 deb 安装的应用会落到裸键拿到 AppImage 字节，`dpkg -i` 失败。
- 只有「产物 + 同名 `.sig`」齐全的平台才写入清单。Linux job 的 artifact 上传必须包含 `*.AppImage.sig` / `*.deb.sig`
  （签名在 manifest 里内联，不需要上传到 R2）。
- 校验：`curl -s https://download.jiaqi.im/inkpoint/desktop/updater.json | jq '.platforms | keys'`。
- 事故记录（2026-10-17）：旧查找只匹配 `*x64*.nsis.zip|*.zip` → Windows 自 0.12.x 起收不到应用内更新；
  （2026-11-08）Linux 签名早已生成但从未上传、也从未写入清单 → Linux 从未收到过应用内更新。

## 合并 PR 后的线上部署决策矩阵

当一个 PR 合并入 `main` 分支后，维护者或 Agent 应先执行 `git checkout main && git pull`，并根据本次 PR 涉及的修改范围决定执行哪项上线命令：

1. **若修改了 `apps/site/` 目录**（如官网文案、Next.js ISR 版本中心 `/releases`、更新日志 UI、样式等）：
   - 执行：`pnpm release:site`
   - 验证：检查 `https://editor.jiaqi.im/` 是否正常生效。
2. **若修改了 `infra/distribution-worker/` 目录**（如分发网关路由、R2 代理策略、静态目录模板等）：
   - 执行：`pnpm deploy:worker`
   - 验证：检查 `https://download.jiaqi.im/` 是否正常生效。
3. **若同时修改了 `apps/site/` 和 `infra/distribution-worker/`**：
   - 先执行：`pnpm release:site`
   - 再执行：`pnpm deploy:worker`
4. **若修改了 `apps/web/` 目录**（Web 在线 Playground）：
   - 执行：`pnpm release:web`
   - 验证：检查 `https://editor.jiaqi.im/playground` 是否正常生效。
5. **若是桌面端客户端版本发布**：
   - 走标准客户端发布命令：`pnpm release:desktop`（由 GitHub Actions 构建多端二进制并自动同步至 R2 与公开 Tap）。
6. **移动端**：不再发版，也没有 CI。需要安装包时在本机执行 `pnpm build:android` / `pnpm build:ios`。

## Linux 双架构分发契约（amd64 / arm64）

- CI 产物命名（`release-desktop.yml`）：AppImage 为 `*_amd64.AppImage` / `*_aarch64.AppImage`，DEB 为 `*_amd64.deb` / `*_arm64.deb`；`x86_64.AppImage` 历史上从未存在，官网与脚本禁止构造该文件名。
- AppImageHub 目录项：AppImage 内必须有 `usr/share/metainfo/*.appdata.xml`（组件 id `dev.md_editor.app`，因为 AppStream 不允许 rDNS 中间段使用连字符；Tauri identifier 仍是 `dev.md-editor.app`。launchable 为 `Inkpoint.desktop`，`project_license` 为 `GPL-3.0-or-later`），不得打包 `libwayland-client.so.0`（由宿主提供），并在 linuxdeploy 打包时写入 `gh-releases-zsync|wmasfoe|md-editor|latest|Inkpoint_*_{amd64|aarch64}.AppImage.zsync`。`release-desktop.yml` 与 `release-beta.yml` 把同名 `.AppImage.zsync` 上传到该仓库的 GitHub Release（AppImageUpdate 的 `latest` 通道读的是这里，不是 R2 或 Homebrew tap）。排除库和 update information 都发生在签名之前；构建后不得再改写 AppImage 字节，否则 Tauri updater 的 minisign `.sig` 会失效。验收读取 ELF `.upd_info` 段和旁边的 `.zsync`，不执行 `--appimage-updateinformation`：CI 设置了 `APPIMAGE_EXTRACT_AND_RUN=1`，type2 runtime 会把该参数交给应用本身。Pull request 的 `Build Linux AppImage` 会跑 `pnpm build:linux`，手动矩阵仍然只在 `workflow_dispatch` 时构建。
- `version.json` 槽位：`linux_appimage` / `linux_deb` 固定为 x64，`linux_appimage_arm64` / `linux_deb_arm64` 固定为 ARM64，由 `update-r2-version-manifest.mjs` 按架构精确匹配写入（禁止取 readdir 首个命中）。
- latest 路由：`/desktop/linux/latest` 与 `/desktop/linux-deb/latest` 默认 x64；ARM 用户走 `/desktop/linux-arm64/latest` 与 `/desktop/linux-deb-arm64/latest`。Worker 绝不跨架构回退（同扩展名仅剩异架构包时才兜底）。
- 架构识别必须同时处理 `aarch64` 与 `arm64`（`aarch64` 不含 `arm64` 子串）：`router.ts` 的 `isArm64AssetName` / `isX64AssetName` 为唯一口径，`sync` 脚本与 manifest 脚本各自镜像该逻辑。
- 线上数据恢复：存量 `version.json` 的 x64 槽位可能指向 ARM 包，随下一次桌面发版重建 manifest 自动修复；紧急时可手动重跑 manifest 脚本并上传 R2。

## 相关文件索引

- `.github/workflows/build-desktop.yml`: PR 和手动触发的跨平台校验构建入口。
- `.github/workflows/release-desktop.yml`: `v*` / `desktop-v*` tag 触发的桌面端 GitHub Release 和 Homebrew tap 同步入口。
- `.github/workflows/release-web.yml`: `web-v*` tag 触发的 Web 端 GitHub Release 与部署工作流。
- `.github/workflows/release-utools.yml`: uTools PR 构建产物和 `utools-v*` tag GitHub Release 工作流。
- `.github/workflows/release-beta.yml`: `beta` 分支 push 触发的桌面端 beta 预发布构建入口。
- `scripts/release/version-desktop.mjs`: 同步更新 desktop package、Tauri config、Cargo manifest 的版本号（root package 保持 `0.0.0` 容器占位），并更新 `apps/desktop/CHANGELOG.md`。
- `scripts/release/publish-desktop.mjs`: 交互式桌面端发版编排脚本。
- `scripts/release/version-web.mjs`: 更新 `apps/web/package.json` 与 `apps/web/CHANGELOG.md`。
- `scripts/release/publish-web.mjs`: 交互式 Web 端发版编排脚本。
- `scripts/release/deploy-web.mjs`: Web 端唯一 Vercel CLI 发布入口；由 `pnpm deploy:web` 触发。
- `scripts/release/validate-utools-release.mjs`: 校验 uTools 版本、tag、正式 manifest 和构建目录完整性。
- `scripts/mobile/build-android-apk.mjs`、`scripts/mobile/build-ios-ipa.mjs`: 本机编译 APK / 未签名 IPA。
- `scripts/release/changelog.mjs`: Changelog 解析与更新共享工具模块。
- `scripts/site/deploy-site.mjs`: 官网唯一 Vercel CLI 发布入口；由 `pnpm release:site` 触发。
- `apps/desktop/CHANGELOG.md`: 桌面端更新历史。
- `apps/web/CHANGELOG.md`: Web 在线端更新历史。
- `apps/utools/CHANGELOG.md`: uTools 插件更新历史。

## Sentry source map

桌面端生产构建（`apps/desktop` 的 `pnpm build`，Tauri `beforeBuildCommand` 会调用它）生成 hidden source map，并用 `@sentry/vite-plugin` 注入 Debug ID。运行时 release 来自 `sentryReleaseName()`，形如 `inkpoint@0.19.2`，**不设置 dist**；上传选项与之相同，否则事件和 artifact 对不上。

上传之后 `scripts/release/strip-sourcemaps.mjs` 删除全部 `.map` 并去掉 `sourceMappingURL`。`scripts/release/assert-no-sourcemaps.mjs` 在桌面构建、网页构建和各平台打包后失败退出，只要产物里还剩 map 或注释。没有 token 时跳过上传；token 失效或 Sentry 不可用时插件只 `console.warn`。两种情况都继续清理和检查，构建不因此失败。

Token 只来自环境变量 `SENTRY_AUTH_TOKEN`。不要写入仓库，也不要使用会被插件自动读取的 `.env.sentry-build-plugin`（已在 `.gitignore`）。

## 必需 Secret

`md-editor` 仓库需要配置：
- `HOMEBREW_TAP_TOKEN`: 写入公开 `wmasfoe/homebrew-tap` 的 cask 文件、安装脚本、updater manifest。
- `TAURI_SIGNING_PRIVATE_KEY`: 签名应用内更新包。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: 仅当私钥设置了密码时需要。
- `VERCEL_TOKEN`: 官网 CLI 部署。
- `VERCEL_ORG_ID`: 官网目标 Org ID。
- `VERCEL_PROJECT_ID`: 官网目标 Project ID。
- `SENTRY_AUTH_TOKEN`: **Secret**（Settings → Secrets and variables → Actions → Secrets）。Sentry org auth token，需要 release 与 project 写权限（Organization token，或 Personal token 的 Project: Read & Write 与 Release: Admin）。只在发版打包步骤里注入：`.github/workflows/release-desktop.yml`（macOS、Linux x64、Linux aarch64、Windows）和 `.github/workflows/release-beta.yml`（macOS、Linux x64、Windows）。`.github/workflows/build-desktop.yml` 的 PR Linux AppImage 与手动多平台构建不注入 token，只跑 strip 和 assert。未配置时跳过上传。创建入口：`https://sentry.io/orgredirect/organizations/lijiaqi/settings/auth-tokens/`。

可选 Variables（Settings → Secrets and variables → Actions → Variables），不配则用代码里的默认值：
- `SENTRY_ORG`: 默认 `lijiaqi`。
- `SENTRY_PROJECT`: 默认 `inkpoint`。
