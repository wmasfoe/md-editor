# 发版指南

这份文档面向人类维护者，说明如何发布 **桌面端 App（macOS / Linux / Windows）**、**Web 在线端（Playground）**、**uTools 插件**和 **官网（site）**。

| 产物 | 推荐命令 | Git Tag 触发契约 | 用户拿到什么 / 发布目标 |
|------|----------|-----------------|------------------------|
| **桌面端 App** | `pnpm release:desktop` | `v*`（例: `v0.10.2`） | DMG、AppImage、DEB、EXE、Homebrew、应用内自动更新 |
| **Web 在线端** | `pnpm release:web` | `web-v*`（例: `web-v0.2.0`） | 独立打包产物 `md-editor-web-*.zip`、GitHub Release 与在线部署 |
| **uTools 插件** | `pnpm build:utools` | `utools-v*`（首版: `utools-v0.1.0`） | 经校验的发布目录 zip 与 GitHub Release；市场审核需在 uTools 开发者工具提交 |
| **官网** | `pnpm release:site` | App release 成功后自动触发；也可手动执行 | 首页与更新记录页（同时展示桌面端与 Web 端双日志 Tab） |

更细的 CI / 脚本实现见 agent 文档：[release_workflow](../agent/release/release_workflow.md)。

---

## 一、桌面端 App 发版

### 1. 推荐流程

在干净的 `main` 分支上：

```bash
pnpm release:desktop
```

脚本会引导选择 `patch` / `minor` / `major` / `beta` 或具体版本号，并填写本次更新说明，然后自动：

1. 调用 `pnpm release:desktop:version` 同步版本文件（desktop、Tauri、Cargo；根目录 package.json 固定为 0.0.0 容器占位）。
2. 把本次说明写入 `apps/desktop/CHANGELOG.md`（新版本 section；已存在则失败，避免覆盖）。
3. 本地构建自检并创建版本 commit。
4. 创建 `v版本号` tag（例如 `v0.10.2`）。
5. push 当前分支和 tag，触发 GitHub Release 跨平台工作流。

预览（不真正改文件 / 不 push）：

```bash
pnpm release:desktop patch --dry-run
```

指定说明或版本：

```bash
pnpm release:desktop minor --notes "改进文件树体验"
pnpm release:desktop beta --notes "测试新版编辑器"
pnpm release:desktop 0.10.2
```

若脚本在版本文件更新后、commit/tag 之前中断，确认版本文件正确后可继续：

```bash
pnpm release:desktop --resume
```

`--resume` 要求 `apps/desktop/CHANGELOG.md` 里**已经存在**目标版本 section，且不会改写该 section。

### 2. 手动分步发版（仅应急）

```bash
pnpm release:desktop:version patch   # 或 minor / major / 0.10.2
# 检查 apps/desktop/CHANGELOG.md
git add .
git commit -m "chore: release v0.10.2"
git push origin main

git tag v0.10.2
git push origin v0.10.2
```

### 3. Beta 版本

```bash
pnpm release:desktop beta
```

- 当前 `0.10.1` → `0.10.2-beta.1`
- 当前 `0.10.2-beta.1` → `0.10.2-beta.2`

Beta 会生成 GitHub **prerelease**，**不会**更新公开 Homebrew tap、cask 与应用内更新 manifest。

---

## 二、Web 在线版发版

Web 端作为独立前端应用，拥有独立的更新日志与发布节奏。

### 1. 推荐流程

在干净的 `main` 分支上：

```bash
pnpm release:web
```

脚本会引导选择版本类型（patch / minor / major），输入更新日志，并执行：
1. 更新 `apps/web/package.json` 中的版本号；
2. 在 `apps/web/CHANGELOG.md` 写入新版本更新说明；
3. 执行 `pnpm build:web` 验证打包与类型检查；
4. 创建 `chore(web): release web-vX.Y.Z` 提交；
5. 创建 `web-vX.Y.Z` tag（如 `web-v0.2.0`）；
6. 推送至远程，触发 `.github/workflows/release-web.yml` 构建打包、创建 GitHub Release 并自动部署；
7. （可选）在本地提示时直接执行 `deploy:web` 立即将新版本通过 Vercel CLI 发布到生产环境。

> [!IMPORTANT]
> `apps/web/vercel.json` 已显式设置 `"git": { "deploymentEnabled": false }`。合并 PR 或推送到 `main` 分支**绝不会**自动触发 Web 生产部署，所有发布均由 `pnpm release:web` 或 `pnpm deploy:web` 严格受控。

### 2. 单独部署上线（无需升级版本）

若需要将当前已构建产物直接发布到生产环境：

```bash
pnpm deploy:web
```

### 3. 仅更新版本号（分步）

```bash
pnpm release:web:version patch
```

---

## 三、uTools 插件发版

uTools 版本以 `apps/utools/package.json` 与 `apps/utools/plugin.json` 共同维护，二者必须一致。首发版本为 `0.1.0`。

```bash
pnpm build:utools
node scripts/release/validate-utools-release.mjs --dist apps/utools/dist
git tag utools-v0.1.0
git push origin utools-v0.1.0
```

`.github/workflows/release-utools.yml` 会自动运行类型检查、单测和生产构建，校验 tag 与三个 manifest 的版本，上传 `inkpoint-utools-0.1.0.zip` 并创建 GitHub Release。PR 与手动 workflow 也会生成短期构建产物，但不会创建 Release。

uTools 官方公开流程要求在开发者工具中填写发布信息、截图并提交审核，目前没有公开的市场发布 API/CLI。因此 GitHub Release 自动化完成后，仍需解压产物并在 uTools 开发者工具中完成市场提交；不要把账号 cookie 或私有接口凭证放入 CI。

---

## 四、官网（site）发版

官网在 monorepo 的 `site/` 包（Next.js），内容来源：
- 页面文案与布局：`site/`
- **更新记录**：同时展示「桌面客户端」（来自 `apps/desktop/CHANGELOG.md`）与「Web 在线版」（来自 `apps/web/CHANGELOG.md`），支持 Tab 自由切换。

### 1. 发布策略

| 场景 | 是否部署官网 |
|------|----------------|
| PR / `main` push | 否（PR 只校验 `pnpm build:site` 等） |
| 推送 `v*` tag 且桌面端 Release 流程成功跑完 | 是（CI 中自动执行 `pnpm release:site`） |
| 本地或 CI 手动执行 | 是（`pnpm release:site`） |

官网采用 **Vercel CLI-only** 发布：
- 仓库内**唯一**发布入口：`pnpm release:site` → `scripts/site/deploy-site.mjs`
- `site/vercel.json` 已设置 `git.deploymentEnabled: false`，关闭 push / PR 触发的自动部署。

### 2. 本地预览与手动发布

```bash
# 本地预览官网
pnpm dev:site

# 构建官网生产静态产物
pnpm build:site

# 发布官网（需本机 Vercel 登录态或环境变量 VERCEL_TOKEN）
pnpm release:site
```

---

## 五、相关命令速查

```bash
# 桌面端 (Desktop)
pnpm release:desktop             # 交互式发版（推荐）
pnpm release:desktop:version     # 仅更新版本文件与日志
pnpm release:desktop patch --dry-run

# Web 端 (Web)
pnpm release:web                 # 交互式发版（推荐）
pnpm release:web:version         # 仅更新版本文件与日志
pnpm deploy:web                  # 仅执行 Vercel CLI 生产环境部署

# uTools 插件
pnpm build:utools
node scripts/release/validate-utools-release.mjs --dist apps/utools/dist

# 官网 (Site)
pnpm dev:site                    # 本地调试
pnpm build:site                  # 静态构建
pnpm release:site                # 生产环境发布
```
