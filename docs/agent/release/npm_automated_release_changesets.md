# npm 子包 Changesets 自动化发版指南

用途：记录基于 Changesets 的 npm 公开子包自动化版本管理、变更意图声明（Changeset）、CI 聚合发版与 GitHub Actions 凭证配置规范。

## 1. 方案背景与发布边界

针对此前手动修改 `package.json`、手动撰写中英文 Changelog 并通过本地终端执行 `pnpm publish` 繁琐且易出错的问题，仓库采用 **Changesets (`@changesets/cli` + `changesets/action`)** 实现自动化版本管理。

### 适用包范围
Changesets 仅接管对外发布的 **6 个公开核心子包**：
* `@md-editor/core`
* `@md-editor/editor`
* `@md-editor/plugin-sdk`
* `@md-editor/shared`
* `@md-editor/markdown-fidelity`
* `@md-editor/plugin-host`

### 忽略包范围（通过 `.changeset/config.json` 严格隔离）
* **终端应用**（拥有独立的构建发布与分发流水线）：`@md-editor/desktop`、`@md-editor/web`、`@md-editor/site`、`@md-editor/utools`、`@md-editor/distribution-worker`、`@md-editor/mobile-core`。
* **私有内部包**：`@md-editor/ai`、`@md-editor/app-ui`、`@md-editor/changelog`、`@md-editor/file-system`、`@md-editor/i18n`、`@md-editor/mdx-plugins`。
* **暂缓发布公开包**：`@md-editor/compiler`、`@md-editor/syntax-plugins`。

---

## 2. 版本界定与最大值汇总机制

Changesets 采用 **「变更意图声明（Intent-based）」** 机制，**不是「一个 PR 一个版本」**：

1. **PR 阶段（只声明，不改版本号）**：
   * 开发者或 Agent 在 PR 中只记录受影响的包与变动级别（`patch` / `minor` / `major`），生成 `.changeset/*.md`；
   * `package.json` 的版本号保持不动，各 PR 之间不会产生 Git 版本号冲突。
2. **多 PR 智能取最大级别（Max Bump）**：
   * 当多次 PR 陆续合入 `main` 后，Changesets 自动计算提升幅度的最大值：
     * 例如一个包积累了两次 `patch` 和一次 `minor`，最终版本只会升一次 `minor`（如 `0.1.0` -> `0.2.0`），避免版本号虚高与碎片化；
     * 期间所有 PR 的改动描述会自动汇聚到该包的 `CHANGELOG.md` 中。
3. **依赖级联（Cascading Bumps）**：
   * 当底层包（如 `plugin-sdk`）升级时，上层依赖包（如 `editor`）会自动联动递增内部依赖版本约束。

---

## 3. 开发者与 Agent 操作指引

当你在 PR 中修改了上述 6 个公开包之一的代码时：

1. **生成变更集**：
   在工作区根目录执行：
   ```bash
   pnpm changeset
   ```
   * 勾选本次修改涉及的包；
   * 选择变更级别（`patch`：向下兼容缺陷修复；`minor`：向下兼容新功能或扩展 API；`major`：破坏性改动）；
   * 编写简明的英文改动说明（1~2 句话）。
2. **提交文件**：
   将生成的 `.changeset/<random-name>.md` 文件提交并推送到当前 PR 分支。
3. **CI 守卫提示**：
   PR 的 CI 流水线包含 `Check Changeset` 步骤（`node scripts/packages/check-changeset.mjs`）。若检测到公开包有改动却未附带变更集，CI 会给出提醒。
4. **严禁事项**：
   * **严禁在 PR 中直接手动修改 `packages/*/package.json` 中的 `version` 字段**；
   * 严禁为 ignored 内部包（如 `ai`、`app-ui` 等）或应用生成 changeset。

---

## 4. 维护者发版流程与凭证配置

### 第一步：配置 GitHub Actions Secret（一次性配置）
在 GitHub 仓库管理后台：
1. 进入 **Settings -> Secrets and variables -> Actions**；
2. 新增 Repository Secret：
   * **Name**: `NPM_TOKEN`
   * **Value**: 具备 `@md-editor` 组织发布权限的 npm Access Token（推荐 Automation 或 Granular Access Token 类型）。

### 第二步：自动化汇总与正式发布
1. **自动生成版本 PR**：
   日常 PR 合并到 `main` 后，`.github/workflows/release-npm-packages.yml` 自动触发。若存在未发布的 changeset，Changesets 机器人会自动创建或更新一个名为 **"chore(release): version npm packages"** 的 PR。
2. **正式发版（一键合入）**：
   * 当准备对外发版时，维护者只需**审核并合并该 Version PR**；
   * 合并后，流水线将自动执行：
     1. 产物构建与独立消费者打包验证（`pnpm verify:packages`）；
     2. 执行发布（`changeset publish` 上传至 npm registry）；
     3. 自动生成对应的 Git Tags（如 `@md-editor/editor@0.2.0`）。

---

## 5. 相关脚本与文件清单

* 配置：[`.changeset/config.json`](file:///Users/ikun/code/md-editor/.changeset/config.json)
* CI 流水线：[`.github/workflows/release-npm-packages.yml`](file:///Users/ikun/code/md-editor/.github/workflows/release-npm-packages.yml)
* 预发布验证与发布包装脚本：[`scripts/packages/publish.mjs`](file:///Users/ikun/code/md-editor/scripts/packages/publish.mjs)
* PR 变更集守卫检查：[`scripts/packages/check-changeset.mjs`](file:///Users/ikun/code/md-editor/scripts/packages/check-changeset.mjs)
