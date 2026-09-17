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
- **官网部署**：
  - 唯一入口为 `pnpm release:site`（`scripts/site/deploy-site.mjs`）；
  - `site/vercel.json` 显式设置 `"git": { "deploymentEnabled": false }`；
  - 承载主站首页、Next.js ISR 全平台版本分发中心（`/releases`）、更新日志（`/changelog`）等；
  - 对应域名：`editor.justdev.cn` 与 `editor.jiaqi.im`。
- **全球边缘分发网关与 R2 存储（Cloudflare Worker）**：
  - 唯一入口为 `pnpm deploy:worker`（`infra/distribution-worker`）；
  - 负责各平台安装包大文件直连（`/inkpoint/desktop/...`、`/inkpoint/android/...`）、版本清单 API（`/api/inkpoint/releases`）、应用内自动更新检查（`/desktop/updater.json`）与静态目录预渲染；
  - 对应域名：`download.justdev.cn` 与 `download.jiaqi.im`。

## 核心发版与部署命令速查

| 命令 | 对应脚本 / 目录 | 说明 |
| :--- | :--- | :--- |
| `pnpm release:desktop` | `scripts/release/publish-desktop.mjs` | 桌面端完整发版流程（版本更新、Changelog 写入、commit、`v*` tag 与 push，同时支持 `desktop-v*`） |
| `pnpm release:desktop:version` | `scripts/release/version-desktop.mjs` | 仅更新桌面端核心版本文件（desktop package, Tauri, Cargo；root package 固定为 `0.0.0` 容器占位）与 `apps/desktop/CHANGELOG.md` |
| `pnpm release:web` | `scripts/web/deploy-web.mjs` | Web 端本地 Vercel CLI 预构建极速上线入口（对标 `release:site`） |
| `pnpm release:web:version` | `scripts/release/version-web.mjs` | 仅更新 Web 端版本文件与 `apps/web/CHANGELOG.md` |
| `pnpm deploy:web` | `scripts/web/deploy-web.mjs` | Web 端部署别名入口 |
| `pnpm release:site` | `scripts/site/deploy-site.mjs` | 官网 Vercel CLI 预构建发布入口（发布至 `editor.justdev.cn` / `editor.jiaqi.im`） |
| `pnpm deploy:worker` | `infra/distribution-worker` | Cloudflare Worker 边缘分发网关发布入口（发布至 `download.justdev.cn` / `download.jiaqi.im`） |
| `pnpm dev:site` | `site` | 本地启动官网 Next.js 开发环境（端口 3000） |
| `pnpm dev:worker` | `infra/distribution-worker` | 本地启动 Cloudflare Worker 边缘网关调试环境（Wrangler） |

## 合并 PR 后的线上部署决策矩阵

当一个 PR 合并入 `main` 分支后，维护者或 Agent 应先执行 `git checkout main && git pull`，并根据本次 PR 涉及的修改范围决定执行哪项上线命令：

1. **若修改了 `site/` 目录**（如官网文案、Next.js ISR 版本中心 `/releases`、更新日志 UI、样式等）：
   - 执行：`pnpm release:site`
   - 验证：检查 `https://editor.justdev.cn/` 和 `https://editor.jiaqi.im/` 是否正常生效。
2. **若修改了 `infra/distribution-worker/` 目录**（如分发网关路由、R2 代理策略、静态目录模板等）：
   - 执行：`pnpm deploy:worker`
   - 验证：检查 `https://download.justdev.cn/` 和 `https://download.jiaqi.im/` 是否正常生效。
3. **若同时修改了 `site/` 和 `infra/distribution-worker/`**：
   - 先执行：`pnpm release:site`
   - 再执行：`pnpm deploy:worker`
4. **若修改了 `apps/web/` 目录**（Web 在线 Playground）：
   - 执行：`pnpm release:web`
   - 验证：检查 `https://editor.justdev.cn/playground` 是否正常生效。
5. **若是桌面端客户端版本发布**：
   - 走标准客户端发布命令：`pnpm release:desktop`（由 GitHub Actions 构建多端二进制并自动同步至 R2 与公开 Tap）。

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
