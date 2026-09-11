# 多端发布与版本管理指南

本项目已对桌面端（Desktop）、Web 在线端（Web Playground）与官网展示端（Site）的发版与上线流程全面解耦。所有发版命令统一收敛至 `release:*` 命名空间，消除历史兼容别名包袱，保持命令工整与职责对称。

---

## 1. 架构总览与命名契约

| 端标识 | 对应工作区 | 版本管理与发版命令 | Git Tag 触发契约 | 关联更新日志 | CI/CD 工作流 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Desktop** | `apps/desktop` | `pnpm release:desktop`<br>`pnpm release:desktop:version` | `v*` / `desktop-v*`<br>(基线: `v0.10.2`) | `apps/desktop/CHANGELOG.md` & `CHANGELOG_EN.md` | `.github/workflows/release-desktop.yml` |
| **Web** | `apps/web` | `pnpm release:web`<br>`pnpm release:web:version` | `web-v*`<br>(例: `web-v0.2.0`) | `apps/web/CHANGELOG.md` & `CHANGELOG_EN.md` | `.github/workflows/release-web.yml` |
| **Site** | `site` | `pnpm release:site` | 随主干部署或 CI 触发 | 聚合读取双端中英文 Changelog 并在官网支持双语切换展示 | 静态部署 / Vercel CLI |

---

## 2. 桌面客户端发版 (Desktop)

### 2.1 脚本说明
- **`pnpm release:desktop:version`** (`scripts/release/version-desktop.mjs`)：
  - 仅自增版本号（支持 patch/minor/major/beta/custom）并生成更新日志条目；
  - 同步更新桌面端核心文件（`apps/desktop/package.json`、`tauri.conf.json`、`Cargo.toml`；根目录 `package.json` 保持为 `0.0.0` 容器占位不耦合各端）；
  - 同步写入 `apps/desktop/CHANGELOG.md`（英文对照维护于同级 `CHANGELOG_EN.md`）；
  - **不**创建 commit 或推送 tag。
- **`pnpm release:desktop`** (`scripts/release/publish-desktop.mjs`)：
  - 包含上述版本号自增与日志记录；
  - 本地运行构建自检；
  - 自动创建 `chore: release vX.Y.Z` 提交；
  - 自动打带附注的 `vX.Y.Z` tag（工作流与客户端同时具备对 `desktop-v*` 的向前兼容）；
  - 推送至远程主干触发 `.github/workflows/release-desktop.yml` 跨平台多架构打包与发布。

### 2.2 常用指令
```bash
# 交互式发布桌面端（推荐）
pnpm release:desktop

# 命令行指定级别或版本
pnpm release:desktop patch --notes "优化文件保存并发调度性能"
pnpm release:desktop 0.10.2 --notes "修复已知缺陷"

# 仅更新版本文件与日志，用于分步审核
pnpm release:desktop:version
```

---

## 3. Web 在线版发版 (Web)

### 3.1 脚本说明
- **`pnpm release:web:version`** (`scripts/release/version-web.mjs`)：
  - 自增 `apps/web/package.json` 版本号；
  - 追加记录至 `apps/web/CHANGELOG.md`（英文对照维护于 `apps/web/CHANGELOG_EN.md`）。
- **`pnpm release:web`** (`scripts/release/publish-web.mjs`)：
  - 自增版本并在 `apps/web/CHANGELOG.md` 写入更新说明；
  - 触发 `pnpm build:web` 执行前端产物构建与类型自检；
  - 自动创建 `chore(web): release web-vX.Y.Z` 提交；
  - 自动打附注标签 `web-vX.Y.Z`；
  - 推送后触发 `.github/workflows/release-web.yml` 打包 Web 产物并发布 GitHub Release。

### 3.2 常用指令
```bash
# 交互式发布 Web 在线版
pnpm release:web

# 命令行快速发布
pnpm release:web patch --notes "新增 MDX 动态沙盒预览支持"
pnpm release:web 0.2.0

# 仅更新版本号
pnpm release:web:version
```

---

## 4. 官网更新与部署 (Site)

官网 `site` 采用 Next.js 构建，内嵌更新日志展示页面（`/changelog`），并支持「桌面客户端」与「Web 在线版」双端日志 Tab 动态切换。

### 4.1 部署指令
```bash
# 本地预览官网
pnpm dev:site

# 构建官网静态产物
pnpm build:site

# 部署官网至生产环境
pnpm release:site
```

---

## 5. 命令行选项说明

桌面与 Web 发版脚本均提供以下高级选项：
- `--dry-run`：预览将要执行的操作与生成的文件变更，不写入实际更改；
- `--resume`：用于发版中断后的恢复，复用已修改的版本号文件直接提交；
- `--no-push`：在本地完成版本修改、提交与打 tag，但不执行 `git push`；
- `--branch <name>`：强制限定发版分支（默认 `main`）；
- `--allow-any-branch`：允许在任意分支执行发版；
- `--yes`, `-y`：跳过最终确认交互提示。
