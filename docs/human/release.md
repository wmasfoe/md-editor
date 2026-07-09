# 发版指南

这份文档面向人类维护者，说明如何发布 **桌面端 App（macOS）** 和 **官网（site）**。

| 产物 | 触发方式 | 用户拿到什么 |
|------|----------|--------------|
| 桌面端 App | 推送 `v*` tag（推荐 `pnpm release`） | DMG、Homebrew、应用内更新 |
| 官网 | App release 成功后自动部署；也可手动 `pnpm deploy:site` | 首页与更新记录页（读根目录 `CHANGELOG.md`） |

更细的 CI / 脚本实现见 agent 文档：[release_workflow](../agent/release/release_workflow.md)。

---

## 一、桌面端 App 发版

### 1. 推荐流程

在干净的 `main` 分支上：

```bash
pnpm release
```

脚本会引导选择 `patch` / `minor` / `major` / `beta` 或具体版本号，并填写本次更新说明，然后自动：

1. 调用 `pnpm release:version` 同步版本文件（root package、desktop、Tauri、Cargo）。
2. 把本次说明写入根目录 `CHANGELOG.md`（新版本 section；已存在则失败，避免覆盖）。
3. 创建符合 Lore 协议的版本 commit。
4. 创建 `v版本号` tag。
5. push 当前分支和 tag，触发 GitHub Release workflow。

预览（不真正改文件 / 不 push）：

```bash
pnpm release patch --dry-run
```

指定说明或版本：

```bash
pnpm release minor --notes "改进文件树体验"
pnpm release beta --notes "测试新版编辑器"
pnpm release 0.3.0-beta.1
```

若脚本在版本文件更新后、commit/tag 之前中断，确认版本文件正确后可继续：

```bash
pnpm release --resume
```

`--resume` 要求 `CHANGELOG.md` 里**已经存在**目标版本 section，且不会改写该 section。

### 2. 手动发版（不推荐，仅应急）

```bash
pnpm release:version patch   # 或 minor / major / 0.2.0
# 手动编辑 CHANGELOG.md，新增目标版本 section
git add .
git commit -m "Prepare release v0.1.3"
git push origin main

git tag v0.1.3
git push origin v0.1.3
```

打 tag 前如需额外确认 DMG 构建，可在 GitHub Actions 手动触发 **Build macOS App**。

### 3. Beta 版本

```bash
pnpm release beta
```

- 当前 `0.2.1` → `0.2.2-beta.1`
- 当前 `0.2.2-beta.1` → `0.2.2-beta.2`

Beta 会生成 GitHub **prerelease**，**不会**：

- 上传到公开 Homebrew tap
- 更新 cask / curl 安装脚本 / 应用内更新 manifest

官网仍会在 release workflow 末尾尝试部署（changelog 会包含 beta 说明，若你写入了 CHANGELOG）。

### 4. 自动化会做什么

**PR** 自动：安装依赖 → lint / typecheck / test / Rust test → 校验版本文件一致。  
需要 DMG 产物时，手动触发 **Build macOS App**。

**推送 `v*` tag** 后，Release workflow 会：

1. 校验 tag 名等于 `v{version}`，且版本文件一致。
2. 校验 Tauri updater 签名相关 secret。
3. 再跑 lint、typecheck、test、Rust test。
4. 分两步构建：DMG，再 `.app.tar.gz` 更新包 + `.sig`。
5. 创建或更新 GitHub Release，并上传上述产物。
6. **beta**：标记 prerelease，跳过 Homebrew 相关步骤。
7. **stable**：把 DMG / 更新包复制到公开 `wmasfoe/homebrew-tap` Release，并更新 cask、`install-md-editor.sh`、`md-editor-latest.json`。
8. 调用 `pnpm deploy:site` 发布官网（同步 changelog）。

### 5. 用户怎样安装 / 更新

- GitHub Release 下载 DMG  
- Homebrew：

```bash
brew install --cask wmasfoe/tap/md-editor
```

- 已安装用户：设置里检查更新（仅 stable signed 更新包）。

### 6. App 发版成功检查

- [ ] `wmasfoe/md-editor` Release 有 DMG、`.app.tar.gz`、`.app.tar.gz.sig`
- [ ] stable 时 `wmasfoe/homebrew-tap` 有 `Casks/md-editor.rb`、`install-md-editor.sh`、`md-editor-latest.json`
- [ ] stable 时 tap 的 `md-editor-v版本号` Release 有同一套 artifact
- [ ] 官网更新记录出现本次版本（见下一节）

---

## 二、官网（site）发版

官网在 monorepo 的 `site/` 包（Next.js），内容来源：

- 页面文案与布局：`site/`
- **更新记录**：仓库根目录 `CHANGELOG.md`（官网只解析展示，不维护第二份数据）

### 1. 发布策略（重要）

| 场景 | 是否部署官网 |
|------|----------------|
| PR / `main` push | 否（PR 只校验 `pnpm build:site` 等） |
| 推送 `v*` tag 且 App Release 流程跑到网站步骤 | 是（`pnpm deploy:site`） |
| 本地或 CI 手动执行 | 是（`pnpm deploy:site`） |

官网采用 **Vercel CLI-only** 发布：

- 不要开 Vercel Git 自动部署
- 不要开 PR Preview / main push production deploy
- 仓库内**唯一**发布入口：`pnpm deploy:site` → `scripts/site/deploy-site.mjs`

### 2. Vercel 侧准备（一次性）

1. 在 [Vercel](https://vercel.com) 新建 Project  
   - Framework：Next.js  
   - **Root Directory：必须设为 `site`**（CLI 从 monorepo 根执行，不要设空）  
2. **关闭** Git 自动部署与 PR Preview  
3. 创建 Token：Account Settings → Tokens  
4. 记下 **Team / Org ID** 与 **Project ID**（Project Settings → General，或本地 link 后的 `.vercel/project.json`）  
5. 可选：绑定自定义域名  

本机首次关联（在 **仓库根目录** link；`.vercel/` 已 gitignore，不会提交）：

```bash
# 在 monorepo 根执行，不要 cd site
pnpm exec vercel login
site/node_modules/.bin/vercel link
```

若以前在 `site/` 下 link 过，`pnpm deploy:site` 会把 `site/.vercel/project.json` 同步到仓库根 `.vercel/`。

### 3. GitHub Secrets（CI 必需）

在 `wmasfoe/md-editor` → Settings → Secrets and variables → Actions 配置：

| Secret | 用途 |
|--------|------|
| `VERCEL_TOKEN` | CLI 鉴权 |
| `VERCEL_ORG_ID` | 目标 Team/Org |
| `VERCEL_PROJECT_ID` | 目标 Project |

CI 缺少任一 secret 时，`deploy-site` 会直接失败。  
App artifact 若已发布成功而官网失败，**App 仍有效**，只需补发官网（见下）。

### 4. 随 App 一起发（默认路径）

正常使用 `pnpm release` 推送 tag 即可。  
Release workflow 在 Homebrew 等步骤之后会执行：

```bash
pnpm deploy:site
```

该命令（`scripts/site/deploy-site.mjs`）会：

1. `vercel pull`：拉取 production 项目配置  
2. `vercel build --prod`：在 monorepo 完整 checkout 里预构建（此时能读到根目录 `CHANGELOG.md`，静态页已嵌入更新记录）  
3. `vercel deploy --prebuilt --prod`：只上传预构建产物，**不在 Vercel 远程再 build**  

发版说明写在 `pnpm release` 的 notes 里即可；脚本会写入 `CHANGELOG.md`，官网预构建后展示最新 section。

### 5. 只更新官网（不发 App）

适用：改了 `site/` 文案/样式、补全了历史 changelog、或 App 已上线但官网失败需重试。

```bash
# 本地（可用本机 vercel login 状态；也可 export 三个 VERCEL_*）
pnpm deploy:site
```

或在对应 release commit / tag 上重跑失败的 workflow job。

**注意**：不要把「只改官网」的变更伪装成 `v*` tag 发版；只改站点时直接 merge 到 `main` 后手动 `pnpm deploy:site` 即可。

### 6. 本地预览官网

```bash
pnpm dev:site      # 开发
pnpm build:site    # 生产构建
pnpm --filter @md-editor/site test
```

### 7. 官网成功检查

- [ ] 生产域名首页可打开  
- [ ] `/changelog` 有最新版本号与条目  
- [ ] 与根目录 `CHANGELOG.md` 顶部 section 一致  

若线上 changelog 为空，检查根目录 `CHANGELOG.md` 是否在部署用的 commit 上，并确认走的是仓库内 `pnpm deploy:site`（prebuilt），不要绕过脚本在 Vercel 控制台对「仅 site 目录」盲点 Deploy / 开 Git 自动部署。

---

## 三、必需 Secret 总表

`wmasfoe/md-editor` 仓库：

| Secret | 用于 |
|--------|------|
| `HOMEBREW_TAP_TOKEN` | 写公开 `wmasfoe/homebrew-tap`（cask、安装脚本、manifest、Release asset） |
| `TAURI_SIGNING_PRIVATE_KEY` | 签应用内更新包 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 仅当私钥有密码时需要 |
| `VERCEL_TOKEN` | 官网 CLI 部署 |
| `VERCEL_ORG_ID` | 官网 CLI 部署 |
| `VERCEL_PROJECT_ID` | 官网 CLI 部署 |

- `HOMEBREW_TAP_TOKEN` 推荐 fine-grained PAT：仅 `wmasfoe/homebrew-tap`，Contents 读写。  
- Tauri updater 私钥 ≠ Apple Developer ID；当前无 Apple 签名时仍为 ad-hoc，Gatekeeper 首次安装体验不会因此改善。  
- GitHub Release 使用 `github.token`，一般无需额外 PAT。

---

## 四、常见问题

### App

- 分支 / `main` push **不会** 发 Release；只有 `v*` tag 会。  
- tag 必须与版本一致，例如版本 `0.1.3` → tag `v0.1.3`。  
- 本地改完版本文件未 commit 时用 `pnpm release --resume`。  
- beta 不更新 Homebrew / 应用内 manifest。  
- Homebrew 404：cask 必须指向公开 tap Release，而不是私有源码仓 Release。  
- 应用内更新不可用：检查 tap 上 `md-editor-latest.json` 与平台 key / 签名。  

### 官网

- `CHANGELOG.md` 已有某版本 section 时，`pnpm release` 普通模式会失败（防重复）；修内容请手改文件后手动部署，或走 `--resume` 且不要指望脚本覆盖 notes。  
- 官网失败不影响已上传的 DMG；补跑 `pnpm deploy:site` 即可。  
- 不要启用 Vercel Git 自动部署，避免和 CLI-only 策略冲突、产生重复或未带 changelog 的部署。  

---

## 五、相关命令速查

```bash
# App
pnpm release
pnpm release patch --dry-run
pnpm release --resume
pnpm release:version patch

# 官网
pnpm dev:site
pnpm build:site
pnpm deploy:site
```
