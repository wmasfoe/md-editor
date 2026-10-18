# 仓库优化与加固方案（技术方案评审稿）

> 用途：记录本轮"体积/首屏、配置单源、巨型文件拆分、工程门禁、依赖卫生"五项优化的现状证据、方案设计、实施顺序与验收标准。
> 状态：**已评审待执行**（本文只做方案，不含代码改动）。
> 范围声明：**不含**跨 app/跨包逐字重复模块收敛（原 `refactor/dedupe-shared-modules`，按决定暂缓）。

---

## 1. 目标

| 编号 | 目标 | 分支建议 |
|---|---|---|
| O1 | KaTeX 运行时收敛：去掉双版本重复与启动即加载 | `perf/single-katex-runtime` |
| O2 | Vite 工作区解析配置单源化（4 份 alias 清单收敛） | `refactor/workspace-vite-aliases` |
| O3 | `distribution-worker/src/router.ts`（2097 行）拆分 | `refactor/split-distribution-router` |
| O4 | 工程门禁与包体预算护栏补齐 | `ci/structure-and-bundle-gates` |
| O5 | 依赖卫生：幽灵依赖 + catalog 收口 | `chore/dependency-hygiene` |
| O6 | 构建产物语义复核（包级 build 不产出产物）+ 发布链路疑似重复构建 | `chore/build-artifact-semantics` |

状态（随实施更新）：O1-P0 已按评审**全部撤回**；O5-1（幽灵依赖）已合并（#165，squash `6f75c81`）；**O1-P1（katex 单版本收敛）已合并**（#166，squash `fbde816`）；**O2（Vite 别名单源化）已合并**（#167，squash `ec5d3e6`）；**O4a（包体预算护栏）已合并**（#168，squash `11eb173`）；**O4b（结构守卫 + web 产物构建入 CI）已实施**（`ci/structure-guard-and-web-build`）；O3/O5-2/O6 未开始。

非目标（本轮不做）：跨 app 组件/数据模块去重、渲染器内部重构、产品功能调整。已登记待后续的复用缺口（本轮不处理）：`apps/utools/src/components/UtoolsFileTree.tsx:32-117` 本地重写了 `packages/file-system/src/tree-view-state.ts:24-120` 已提供的路径 helper（Web 已复用：`apps/web/src/components/WebFileTreePanel.tsx:13-19,84-105`）；因属“跨 app 去重”范畴，与暂缓项合并处理。

---

## 2. 基线（本次实测，可作为改造前后对照）

### 2.1 门禁现状

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | ✅ 全 workspace 通过（12 个 package + desktop/web/utools/site/mobile-core + worker） |
| `pnpm test` | ✅ 通过（workspace vitest + `test:release` 84 tests/13 suites + `test:structure` 12 tests，0 fail） |
| `node scripts/structure/check.mjs --phase pr3` | ✅ 通过，3 条 >800 行 warning + 1 条豁免 |
| `pnpm lint`（含 oxlint/prettier/structure/clippy） | 本轮未整体执行（耗时长）；组件均已单独验证 |

结构 warning：`apps/desktop/src/app/controller/useDesktopEditorController.ts`(835)、`apps/utools/src/components/UtoolsApp.tsx`(1139)、`apps/web/src/lib/web-file-system.ts`(841)。
唯一豁免：`infra/distribution-worker/src/router.ts`(2097)。

### 2.2 产物基线（真实 CLI 构建，`apps/web`）

| 指标 | 数值 |
|---|---|
| 入口 chunk `index-*.js` | 1 543.92 kB（gzip 500.94 kB） |
| `katex-BvMrAMpG.js`（math-loader 动态导入） | 261 228 B（gzip 77 482 B） |
| `katex-C5jXJg4s.js`（mermaid 内部动态导入） | 261 329 B（gzip 77 272 B） |
| `mermaid.core-*.js` | 688.94 kB |
| `cynefin-*.js` / `cytoscape.esm-*.js` | 690.86 kB / 443.83 kB |
| 三端 dist 体积（web/desktop/utools） | 6.7 MB / 7.2 MB / 6.7 MB，**三端各含上述两份 katex chunk** |

### 2.3 关键事实

- **KaTeX 双份是版本范围不相交的必然结果**：`mermaid@11.17.2` 声明 `katex: ^0.16.47`（`node_modules/.pnpm/mermaid@11.17.2/node_modules/mermaid/package.json`，`dependencies` 而非 peer）；工作区 `packages/syntax-plugins`、`packages/compiler`、`apps/mobile/core`、`apps/site` 声明 `^0.18.6`。锁文件因此同时存在 `katex@0.16.47` 与 `katex@0.18.6`。
- **首屏加载的根因不是缺少动态拆包，而是模块作用域副作用**：`packages/syntax-plugins/src/math/math-loader.ts:30-35` 在模块求值时无条件 `void loadKatex()`；`packages/syntax-plugins/src/index.ts`（math 块收尾于第 20 行）静态 re-export 该模块，而 web/desktop 从根入口静态导入插件 → 任何文档、哪怕没有公式，都会在启动时拉取 katex chunk。
- **Ghost dependency**：`apps/desktop`、`apps/web`、`apps/utools` 的 `src/styles.css:2` 都 `@import "katex/dist/katex.min.css"`，但三者的 `package.json` **都没有声明 `katex`**（已核实三者 `node_modules` 下无 katex）。当前依赖 pnpm 的隐式提升侥幸解析成功。
- **仓库自带的包体探针已失效且零引用**：`apps/desktop/scripts/code-language-bundle-probe.mjs` 用 Vite `build()` API（`write:false`）构建，当前直接失败（`[@tailwindcss/vite:generate:build] Can't resolve 'katex/dist/katex.min.css'`）；同一环境下真实 CLI（`npx vite build`）构建**成功**（exit 0）。探针未被任何 script/workflow/test 引用。
- **alias 清单实际是 4 份**：`apps/web` 12 条、`apps/desktop` 10 条、`apps/utools` 7 条、`apps/mobile/core` 8 条；另有 `apps/site/next.config.ts` 的 7 条 `transpilePackages` 与 `packages/editor-ui/tsconfig.json` 的 4 条 `paths`。
- **CI 覆盖矩阵**：main 上 PR 触发的工作流只跑 `lint:oxlint` + `format:prettier:check`（**不含 `lint:structure`**）、`typecheck`、`pnpm test`、e2e、rust 校验；**web 应用生产构建在 PR 上从不运行**（`release-web.yml` 仅 `web-v*` tag 触发），桌面 Vite 产物只在 `workflow_dispatch` 构建；utools/site/mobile 有 PR 构建门禁。
- **在途分支会改变 O4 落点**：`origin/ci/split-validation-and-macos-build` 新增 `.github/workflows/ci.yml`（单 job `validate`，跑完整 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:rust`），并把 `build-desktop.yml`/`release-desktop.yml` 重命名为 `build-macos.yml`/`release-macos.yml`（原 lint/typecheck/test 职责迁入 `ci.yml`）。该分支一旦落地，**"CI 不跑结构守卫"这一缺口自动消失**。
- **性能护栏基础设施已存在但未成体系**：`packages/renderer-codemirror/src/diagnostics.ts` 提供 20+ 计数器（`fullIndexBuildCount`、`projectionMapSkipCount`、`languageLoadAttemptCount` 等），已被 `tests/wysiwyg/code-block-performance.test.ts`、`tests/markdown/m1-baseline.test.ts` 与 e2e `codemirror-m2-code-block-performance.spec.ts` 消费；但 `docs/agent/status/codemirror_renderer_migration_status.md` 明确记录 **S6 性能基线「未开始」**。
- 仓库卫生：远程堆积多批已合并未删除的分支（`refactor/*`、`fix/*` 各 1–2 ahead），违反 AGENTS.md 第 11 条预期。

---

## 3. 方案

### O1 KaTeX 运行时收敛

**P0：去掉启动即加载 + CSS 惰性化（已全部撤回，见下方实施记录）**

1. `packages/syntax-plugins/src/math/math-loader.ts`：删除 `:30-35` 的模块作用域预加载块；保留 `loadKatex()` 的单例 + 失败重试（`:12-27`）。这不违反既有契约，反而更忠实于 `docs/agent/architecture/markdown_syntax_plugin_architecture.md:141-144`「按需加载…不增加主包初次加载体积」的原文要求。
2. `packages/syntax-plugins/src/math/math-projection.ts`：把样式加载与既有 `MathInlineWidget.toDOM` / `MathBlockWidget.toDOM` 的首次渲染衔接（`:42-58, 125-140` 已有"加载完成后重绘并重测"路径），样式加载需单例化。**不改**插件语法注册时机，避免首轮解析丢 math 节点。
3. 移除 5 处全局 CSS 中的 KaTeX import：`apps/web/src/styles.css:2`、`apps/desktop/src/styles.css:2`、`apps/utools/src/styles.css:2`、`apps/mobile/core/src/styles.css:2`、`apps/site/app/globals.css:2`；改为随公式功能异步加载本地打包的 CSS 与字体（保持离线自包含，不得改成 CDN）。`apps/site` 需覆盖 `mdx-wipe-canvas.tsx` 的静态 `SiteLiveEditor` 调用路径，并以 `next build` 产物实证。
4. **例外与边界（必须单列验收）**：`apps/mobile/core` 的阅读路径是同步 compiler 链路 —— `ReaderCanvas.tsx:2,17 → renderStaticHtml → compiler/src/emitter/html-emitter.ts:3 → math-render.ts:1 import { renderToString } from "katex"`，**不受本次改动影响**；mobile 默认示例本身含公式。不要把 web 的改善数字外推到 mobile。
5. 同步更新 `markdown_syntax_plugin_architecture.md:142-144` 与"样式装配"段落（`:144`）。

**P0 实施记录（已全部撤回，仅保留最小依赖卫生修复）**

- 原计划「去预加载 + CSS 惰性化」整体撤回，两次原因：
  1. **体验**：延后加载会让首次公式出现「占位符（原始 LaTeX 文本）→ 排版结果」的可见替换，块级公式（`.cm-md-math-block` 有 `padding: 1rem`）还伴随一次高度重测位移；该代价高于首屏多一份 KaTeX 的代价。已恢复浏览器环境下模块作用域的尽早预加载，并加测试锁定。
  2. **行为不确定**：把样式归属移入包内（静态引入）虽能消除幽灵依赖，但样式产物会跟随包含 math 模块的 chunk 走 —— 实测 desktop 的 KaTeX 样式从入口 CSS 移到了 `SettingsDialog-*.css`（该 chunk 由入口动态加载；widget 代码与样式同 chunk，功能上应仍能带出样式）。属构建细节层面的行为变化，不适合放进「行为不变」的修复。
- **本 PR 最终只做最小依赖卫生修复**：在 `apps/web` / `apps/desktop` / `apps/utools` 声明 `katex` —— 这三个应用本就在入口全局引入官方样式，此前仅靠 pnpm 隐式提升解析（幽灵依赖）。样式引入位置、产物结构与 main 完全一致。
- 新增契约测试 `packages/syntax-plugins/tests/katex-stylesheet-contract.test.ts`：引入官方样式的应用必须声明 `katex`；包内不得引入官方样式（防重复投放）。
- **O1-P1（katex 双版本收敛）不受影响**：三端仍各多打一份 261 kB（gzip 77 kB）的 KaTeX，仍需先补 mermaid 数学图回归。
- 保留备选方案（未来若要重做首屏优化可重新评估）：① 占位符视觉对齐（`font-size: 1.05em`/斜体）+ `void loadKatex()` 失败兜底；② 应用层按文档是否含 `$` 预热；③ 索引阶段预热。

**P1：版本收敛到单实例**

- 首选：根 `package.json` 增加 scoped override（概念形式 `mermaid>katex: 0.18.6`），重算锁文件。可行性依据：mermaid 的 ESM 路径只在 `dist/chunks/mermaid.core/chunk-DU6HZSFF.mjs:5212-5245` 使用 KaTeX，且**唯一调用是 `katex.renderToString(tex, { throwOnError, displayMode, output })`**，`output` 取 `mathml`/`htmlAndMathml`；本地两份 `types/katex.d.ts` 中该签名与取值域一致。
- 归因提醒：`peerDependenciesMeta` **不能**完成收敛（mermaid 把 katex 放在 `dependencies`）；mermaid 的 `dist/mermaid.js` 单体 UMD 内嵌 0.16.47 副本不受 override 影响。
- 合并前必须补 mermaid 数学图回归（现有 `packages/syntax-plugins/tests/mermaid.test.ts:175-195` 不含 `$$…$$` 场景）。

**P1 实施记录（已完成，分支 `perf/dedupe-katex-version`，基于 main）**

- **重要修正（与上文的偏离）**：pnpm 11 **不再读取 `package.json` 的 `pnpm` 字段**（实测警告：`The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.overrides"`）。override 必须写在 `pnpm-workspace.yaml`；父子选择器 `"mermaid>katex"` 语法可用。
- 落地：`pnpm-workspace.yaml` 新增 `overrides: { "mermaid>katex": "0.18.6" }`（附原因注释 + 回归证据路径）。
- 回归（先补，且均在 override 前跑通基线）：
  - `packages/syntax-plugins/tests/katex-mermaid-contract.test.ts`：锁定 mermaid 的调用形状 `renderToString(c, { throwOnError: true, displayMode: true, output: "mathml" | "htmlAndMathml" })` 与 `throwOnError` 语义；
  - `apps/desktop/e2e/codemirror-mermaid-math.spec.ts`：真实浏览器里载入含 `A["$$x^2+y^2=z^2$$"]` 的 mermaid 图，断言 SVG 内 `.katex` 存在且无降级文案（node 环境不可行：mermaid.render 需要真实 DOM）。
- 实测效果：lockfile 仅剩 `katex@0.18.6`（0.16.47 条目消失）；web dist **6.7 MB → 6.5 MB**；katex JS chunk **2 → 1**（三端各省 261,329 B / gzip 77,272 B，合计 ≈ 765 kB / gzip ≈ 226 kB）；mermaid chunk 尺寸不变（688,940 → 688,936 B）。
- 边界：`apps/mobile/core` 因 compiler 静态引入 katex，会把 katex 内联进主 chunk（无独立 chunk 文件），但全产物仍只有 **1 份** katex 代码；断言口径应为「含 katex 代码的 JS 产物数 = 1」而非「chunk 文件名」。`node_modules/.pnpm/katex@0.16.47` 目录会磁盘残留（pnpm 不 prune），不参与解析。

**备选对比**

| 方案 | 优点 | 风险 | 建议 |
|---|---|---|---|
| scoped override → 0.18.6 | 保留现有工作区版本；改动集中在根 override + 锁文件 | 越过 mermaid semver 声明；MathML 行为未由本地证据证明 | **推荐先试**（先补回归） |
| 工作区降到 0.16.47 | 与 mermaid 声明一致 | 需改 4 处声明，回归面更大 | override 不可行时选 |
| 保留双份，仅做 P0 | 无跨版本风险 | 安装/部署仍双份，mermaid 数学图仍传第二份 runtime | P1 风险不可接受时降级 |

**验收**：无公式文档首屏不发起 katex JS/CSS 请求；含公式文档首次公式仅触发一次加载；`pnpm why katex` 收敛为单版本；`syntax-plugins`/`compiler`/`mobile-core`/`desktop test:quicklook` 测试通过。注意：P0 后磁盘上仍可能存在 katex 异步 chunk，成功标准是**不请求**而非 chunk 消失。

---

### O2 Vite 工作区解析配置收敛

**推荐方案 C：先统一生成方式保留语义，再用 alias-free 测试逐项裁剪。**

1. 新增 `scripts/vite/workspace-aliases.mjs` + 配套 `scripts/vite/workspace-aliases.test.mjs`（`scripts/*` 子目录规范要求自带 `*.test.mjs`）。API 建议：
   `createWorkspaceAliases(configUrl, profile: "web" | "desktop" | "utools"): Array<{ find: string | RegExp; replacement: string }>`。
   目标路径从对应包的 `exports` 读取，找不到对应 export 必须**失败**而不是拼私有路径；保留现有匹配语义（根包名锚定正则、子路径字符串）。profile 用实测的 12/10/7。
2. 改三份 `vite.config.ts` 使用 helper；只移 alias，不动 app 自有设置（web 的 `base`/端口、desktop 的 `__APP_VERSION__`/server、utools 的 bundle 插件与 `base: "./"`）。utools 的本地 `workspacePath` **不能删**（还用于复制 logo/preload/plugin.json）。
3. 补 alias-free 验证：新建 `apps/web/tests/vite-workspace-resolution.test.ts`、`apps/utools/tests/vite-workspace-resolution.test.ts`，并与现有 `apps/desktop/tests/vite-aliases.test.ts` 一同改造 —— 用清空 `resolve.alias` 的 test-only 配置验证 `exports` fallback（至少覆盖 file-system、i18n、`mdx-plugins/metadata`、`editor-ui/hooks`、`editor-ui/CodeMirrorEditor/testing`）。
4. 同步改造 `packages/editor-ui/tests/hooks-boundary.test.ts`（它读 desktop vite 配置文本，迁到 helper 后会产生假阴性）。
5. `apps/site` 不纳入 helper（用 `transpilePackages`，无 Vite alias，tsconfig 无 `paths`）；`apps/mobile/core` 的 8 条 alias 作为独立 profile 单列评审，不静默并入。

**已验证的反证**：desktop 的 alias 清单里没有 `@md-editor/file-system` 与 `@md-editor/i18n`，但源码大量直接 import 二者（如 `apps/desktop/src/desktop/file-service.ts:5`、`apps/desktop/src/components/SettingsDialog.tsx:3`），说明 `workspace link + exports` 链路可用。

**未证风险**：仓库内无法证明移除 alias 后 Vite 的 optimizeDeps/pre-bundling 行为不变，因此必须用真实 `vite build` + 冷启动 dev smoke 兜底；alias-free 全部通过后应删除 helper，不留空抽象。

**O2 实施记录（已完成，分支 `refactor/workspace-vite-aliases`）**

- 结论比方案更彻底：三个 app 的 alias **全部删除，不引入 helper**。可行性由探针确定（清空 `resolve.alias` 后用真实 Vite resolver 解析）：web 14/14、desktop 14/14 全部经 `exports` 回退解析到 `packages/*/src`；utools 12/14 的两项失败是它**本就不依赖**的包（`i18n`、`renderer-codemirror`）。即所有 alias 均为冗余的第二份入口描述。
- 改动：`apps/{web,desktop,utools}/vite.config.ts` 删除 `resolve.alias`（净减 **29 条**）；utools 的本地 `workspacePath` **保留**（bundle 插件仍用于复制 logo/preload/plugin.json）；新增 3 份解析契约测试（对象级断言无 `resolve.alias` + 源码级断言无 `resolve:` 块 + 每个工作区依赖/子路径经 `exports` 解析到 `packages/*/src`）；删除语义已反转的 `apps/desktop/tests/vite-aliases.test.ts`。
- `apps/mobile/core` 按方案**单列，本轮不动**（8 条 alias 留待独立评审）。
- 验证：三 app 构建成功；**dev 冷启动 smoke**（起 dev server 后 curl 首页 + `/@fs/<repo>/packages/editor-core/src/index.ts`）三端均 200 且返回转换后 JS、**无 `.vite/deps` 预打包引用**；三 app 单测 24/196/24 通过；desktop 全套 Playwright（189 tests）通过；`pnpm test/lint/typecheck` 全绿。
- smoke 踩坑（供后续复用）：Vite 默认绑定 `localhost`（本机可能解析到 `::1`），smoke 需显式 `--host 127.0.0.1`；带 `base`（如 web 的 `/playground/`）时 `/@fs` 请求也必须带 base 前缀。

---

### O3 `router.ts` 拆分

**现状**：2097 行；`handleRequest` 独占 1082 行（`router.ts:1016-2097`，51.6%），`buildReleasesManifest` 532 行（`:361-892`），两者合计 77%。路由顺序本身有行为语义，不得按 URL 前缀重排。

**目标结构**（均 <500 行，远低于 800 告警线）：

```text
infra/distribution-worker/src/
├── router.ts                       # handleRequest：入口、顺序调度、最终 404（~120–180）
├── router/{config,context}.ts      # 常量/请求上下文/缓存/respond/trackDownload（~125–190）
├── router/routes/{system,manifest-api,latest-artifacts,catalog}.ts   # 按现有顺序的四组路由（~1050–1280 合计）
├── distribution/{platform-assets,github-releases,object-responses}.ts # MIME/架构/匹配、GitHub 抓取缓存、代理与 R2 响应
├── releases/{semver,release-sources,mobile-history,manifest}.ts       # 版本比较、来源优先级、移动端历史、清单编排
└── shared/format-bytes.ts          # 供 portal 与 release 共用，解除发布逻辑对 HTML 模块依赖
```

**关键约束**：

- `src/index.ts` 默认 Worker 导出与 `handleRequest` 签名不变；`router.ts` 仍实现 `handleRequest`，不变成 barrel；**不保留兼容 re-export**（AGENTS.md 第 10 条）。
- 保持源码现有顺序：purge/root(1093-1228) → manifest API(1230-1411) → GitHub/updater(1413-1488) → latest 资产(1491-1800) → 快捷跳转/目录/历史(1805-2097)。
- `release-sources.ts` 保持 R2 `releases.json` → GitHub → fallback 的优先级；`platform-assets.ts` 收拢重复的 MIME 表（现同时存在于 `router.ts:29-41` 与 `:1668-1674`）。
- 测试改为直接从新模块导入 helper，不通过 `router.ts` 转发。

**分 5 步实施**（每步独立可过 lint/test/typecheck）：
1. 建立确定性基线：把所有上游 fetch 显式 stub（注意 `tests/router.test.ts:829-851` 当前会真实访问 GitHub），补 `proxyGitHubAsset` Range/206 与 `serveR2Object` 响应头测试。
2. 抽无状态 helper（平台/MIME、semver、GitHub 抓取缓存、对象响应、应用常量）+ 更新测试导入。
3. 拆 `buildReleasesManifest`（来源加载 / version.json / 移动端历史 / 编排）。
4. 抽请求上下文，再按原顺序逐族抽路由。
5. `router.ts` 降到 <800 行后，从 `structure-exceptions.json` **与** `scripts/structure/exceptions.baseline.json` 同步删除 `infra-router-module`；拆分过程中每次缩小都把 `maxLines` 一并下调（豁免只降不升，禁止新增豁免）。cluster/协作者登记机制不适用于 `infra/`。

**验证**：`pnpm --filter @md-editor/distribution-worker build|typecheck|test` + `pnpm lint:structure`；断言覆盖 matcher ARM/x64 规则、来源优先级、status/Location/Content-Type/CORS/Cache-Control/Content-Disposition、统计只归属具体版本且经 `waitUntil`。

---

### O4 工程门禁与包体预算

**A. 门禁差集（以 main 为准）**

| 检查项 | 本地 `pnpm lint`/`pnpm test` | main CI（PR） | 结论 |
|---|---|---|---|
| `lint:oxlint` / `format:prettier:check` | ✅ | ✅（`build-desktop.yml` lint job） | 齐 |
| `lint:structure`（仓库级结构守卫） | ✅ | ❌ | **缺口** |
| `lint:rust`（fmt + clippy） | ✅ | ✅（同文件 `test-rust` job） | 齐 |
| `test:structure`（检查器单测） | ✅ | ✅（经 `pnpm test` 间接） | 齐 |
| web 生产构建 | — | ❌（仅 tag） | **缺口** |
| 桌面 Vite 产物构建 | — | ❌（仅 `workflow_dispatch`） | **缺口** |
| utools / site / mobile 产物构建 | — | ✅ | 齐 |

**落点（两条路径，均为行级引用）**：
- 若 `origin/ci/split-validation-and-macos-build` 先落地（该分支已把校验职责从 `build-desktop.yml` 拆出）：
  - 门禁主入口是 `.github/workflows/ci.yml`（共 100 行）：job `validate:` 在第 14 行，`permissions` 14–18，`steps` 20 起；其中 **Lint `74-75`（`run: pnpm lint`）**、Typecheck `77-78`、Test `80-81`、Test Rust `83-84` —— 已含 `lint:structure`，无需再加。
  - tag 发布链路的校验在 `release-macos.yml` 的 job1 `validate:`（第 13 行，ubuntu），其中 **Lint 段落 `108-109`、Typecheck `111-112`、Test `114-115`、Test Rust `117-118`**；job2 `release:`（第 120 行）以 **`needs: validate`（第 122 行）** 并消费 `needs.validate.outputs`，不重复校验。
  - 届时 O4 的增量动作只剩两件：(a) 在 `ci.yml` 增加 web/desktop 产物构建 smoke（当前该文件只跑 lint/typecheck/test/test:rust/版本一致性）；(b) 为 `build-macos.yml`（共 81 行，job `build:` 第 11 行，`Build macOS app` 步骤 `73-74`）保留产物门禁。
  - **采纳该分支前必须补回两项覆盖（否则是净回退）**：其 `ci.yml` 把 Rust 校验从 main 的三平台 matrix（`build-desktop.yml:124-165`）收敛为单 Ubuntu job，且**没有 Browser E2E**（main 有独立 macOS E2E job，`build-desktop.yml:97-122`）。需在 `ci.yml` 增加 `test-e2e` job 并决定是否恢复 Rust 跨平台 matrix；另需确认 branch protection 的要求集合包含新 job（不能只要求 `validate`）。
  - tag 发布链路不自动继承 `ci.yml` 的校验：`release-web`/`release-utools`/`release-mobile` 等只跑各自 app 定向验证，是否要求全仓根门禁属发行策略决策。
- 若该分支不落地：在 main 的 `build-desktop.yml` lint job（现只有 `pnpm lint:oxlint` 与 `pnpm format:prettier:check`）追加 `run: pnpm lint:structure`（或合并为一步 `pnpm lint`），并把结果纳入 `ci-status` 聚合 job 的 `needs`。

**B. 包体/首屏预算护栏**

**O4a 实施记录（已合并，分支 `ci/bundle-budget-guard` / PR #168，squash `11eb173`）**

- 前提：探针此前跑不通是因为幽灵依赖（`build()` API 路径解析 `katex/dist/katex.min.css` 失败）；#165 修完后 `node apps/desktop/scripts/code-language-bundle-probe.mjs` **已恢复可用**（实测 exit 0）。
- 新增 `apps/desktop/scripts/bundle-budget.mjs`（纯逻辑）+ `bundle-budget.test.mjs`（6 用例，`node --test`）：指标口径为 **minify+gzip 字节数**（确定性、与机器性能无关，因此可用绝对阈值），阈值 = 基线 × (1 + headroom 3%)；基线缺指标时显式报错而非静默放行。
- 新增基线 `apps/desktop/scripts/bundle-budget.baseline.json`（当前：boot 580,962 / total 1,838,252 / chunkCount 80）；`chunkCount` 仅作信息展示（代码分割策略变化会合法地改变它）。
- 探针增加预算判定与 `--update-budget`；根脚本新增 `test:bundle`（逻辑单测 + 探针）与 `test:bundle:update`，并**串入根 `pnpm test`** —— 这样不改任何 CI 文件也能被 CI 执行（CI 跑 `pnpm test`）。
- 检测能力已反证：把基线临时调低 10% → 探针 exit 1 并输出 FAIL 明细（随后已还原）。
- 实测运行间波动 ≈0.4%（boot 580,962 ↔ 583,438；total 1,838,252 ↔ 1,849,827），3% headroom 足以吸收；若未来出现接近阈值的持续漂移，应先确认是否为真实增重。
- 未纳入本项（属 O4b，需先定 CI 分支取舍）：`lint:structure` 门禁落点、web/desktop 产物构建 smoke、把预算护栏提为独立 PR 必选状态。

- 先修 `apps/desktop/scripts/code-language-bundle-probe.mjs`：它当前无法运行（`build()` API 路径解析失败），只遍历静态 `chunk.imports`、不报告 `dynamicImports`/CSS/原始字节 —— 恰好无法识别“模块顶层触发的动态 import”这种本次要防的回归；且它的退出码只检查 `excludedModules`，**目前根本不是预算护栏**。
- 修好后先建立成功构建的 boot/total gzip 基线，再设阈值（并留 headroom）后接入门禁。注意指标选择：**包体/首屏用确定性的 gzip 字节**；而 `apps/tui/tests/perf-guard.test.ts`（在途分支）的“同进程比值 + 多次采样取最小值”适用于**运行时耗时**（理由见其 `:1-13`：共享 runner 上 GC/调度尖峰可把单次读数抬高 5–10 倍），不可直接把 TUI 的数值阈值搬到 bundle 场景。
- 落点：若拆分分支落地 → 在 `build-macos.yml` 的 `build` job（`:11-15`）中、`Build macOS app`（`:73-74`）之后、`Upload DMG`（`:76-81`）之前跑预算检查；能稳定在 Linux 复现时也可做成 PR 必需 job。若未落地 → main 的 Desktop 产物 job 仅 `workflow_dispatch`（`build-desktop.yml:190-192`），必须新设 PR `bundle-budget` job 才能真正形成门禁（`test-e2e` 跑的是开发 server，等价不了生产 bundle 检查）。

**C. S6 性能基线（最小闭环）**

`docs/agent/status/codemirror_renderer_migration_status.md` 记录 S6「未开始」。已有 `diagnostics.ts` 计数器 + `code-block-performance` 单测/e2e 先例，建议先固化"编辑器打开 + 首次投影 + 单字符输入"三个 fixture 的计数与耗时门槛，再逐步扩展，不新造观测设施。

**O4b 实施记录（已完成，分支 `ci/structure-guard-and-web-build`，基于 main）**

- 先核实了在途分支 `origin/ci/split-validation-and-macos-build`：**最后提交 2026-07-07（3 个多月前）、从未合并**；其 `ci.yml` 只在 ubuntu 跑 `pnpm lint`/`test`/`test:rust`，**没有 Browser E2E，且 Rust 三平台 matrix 收敛为单平台**。因此不做“等它落地 / cherry-pick 它”的取舍，改为在 main 的 `build-desktop.yml` 上最小补齐。
- 改动两处：
  1. `lint` job 增加 `Lint (Structure)` → `pnpm lint:structure`（**不能**换成 `pnpm lint`：会连带 cargo fmt/clippy，而该 job 未装 Rust；Rust lint 已由 `test-rust` job 覆盖）
  2. `test-unit` job 增加 `Build Web app (production)` → `pnpm build:web`（`apps/web` 产物此前只在 `web-v*` tag 时构建，PR 阶段发现不了构建期问题，例如幽灵依赖导致的 CSS 解析失败）
- 桌面端产物构建 smoke 不重复添加：O4a 的 `test:bundle` 探针已做一次完整 desktop Vite 构建（并已串入 `pnpm test`）。
- 未做（属仓库设置而非文件改动）：把聚合门禁 / 包体预算提为 branch protection 的必需状态。
- 保留结论：**不采纳**那个陈旧分支的 CI 拆分（其代价是丢 Browser E2E 与跨平台 Rust 验证）。

---

### O5 依赖卫生

1. **消除 katex CSS 幽灵依赖**（与 O1 P0 同批）：要么在 `apps/{desktop,web,utools}` 声明 `katex`，要么（更符合边界原则）把 CSS 归属移入 `packages/syntax-plugins`（它已声明 katex），由包自己负责样式，app 不再出现裸 specifier。倾向后者。
2. **catalog 收口**：当前 `pnpm-workspace.yaml#catalog` 14 个键；仓库自管 `package.json` 共 **118 处** `catalog:` 与 **50 处**字面量；"在 catalog 中却仍写字面量"的情况为 **0**（一致）。建议补录高频共享依赖：`katex`、`@types/katex`、`mermaid`、`@codemirror/state`、`@codemirror/view`、`@lezer/common`、`@lezer/markdown`、`@tailwindcss/*` 之外的 `react-scope` 复核。不改 `react` 范围（`>=18.3.0 <20` 只在 desktop 出现，先单独确认）。
3. **分支卫生**：按 AGENTS.md 第 11 条清理已合并的远程分支（`gh pr merge --delete-branch` 之后的遗留），避免后续审计继续被噪声干扰。

---

### O6 构建产物语义与发布链路复核（`chore/build-artifact-semantics`）

由本次检索发现、尚未纳入任何既有方案的两点：

1. **`packages/*` 的 `build` 实际不产出任何产物**：`tsconfig.base.json:17` 为 `noEmit: true`，各包 `build` 都是 `tsc -p tsconfig.json`，仓库内既无 `packages/*/dist` 也无任何消费者引用它。因此根 `pnpm build` 对 12 个包是“隐式 typecheck”，语义容易误导。建议：把包级 `build` 显式改为 typecheck 专用或删除，并确保 `release-*` 链路里依赖它的隐式类型检查由显式 `pnpm typecheck` 补足。
2. **发布链路疑似重复构建**：`release-web.yml:50-65` 先 `pnpm build:web` 再 `pnpm deploy:web`，而 `scripts/web/deploy-web.mjs:158-165` 又会执行 `vercel build --prod` + `--prebuilt` 部署；`apps/site` 类似（CI `next build` + `scripts/site/deploy-site.mjs:37-38` 的 Vercel build）。**在确认 Vercel 是否复用前不得直接移除 CI 侧构建**（它可能是唯一的 PR 可见验证）；本项先做确认与记录，再决定是否去重。

真实交付物清单（保留，勿删）：Desktop frontend bundle（`tauri.conf.json` `frontendDist: ../dist`）、Mobile `dist`（由 `scripts/mobile/sync-mobile-web.mjs` 注入 iOS/Android 资源）、uTools `dist`（含生成的 release `plugin.json`）、QuickLook `quicklook-engine.js`（由 `packages/compiler/src/index.ts` 打包，`build-quicklook.sh` 复制进 `.appex`）。另注：`test:quicklook` 会注册系统扩展与操作 `/Applications`，属开发者 smoke，不应进 CI（CI 用 bundle 构建/校验路径）。

---

## 4. 实施顺序与交付切分

| 顺序 | 内容 | 分支 | 依赖关系 |
|---|---|---|---|
| 1 | O1-P0（去预加载 + CSS 惰性化）+ O5-1（幽灵依赖） | `perf/single-katex-runtime` | 无 |
| 2 | O1-P1（override 收敛）+ mermaid 数学图回归 | 同上或 `perf/dedupe-katex-version` | 依赖 1 的验证结果 |
| 3 | O2（alias helper + alias-free 测试，随后裁剪） | `refactor/workspace-vite-aliases` | 无 |
| 4 | O4（CI 门禁落点 + 探针修复 + 预算护栏） | `ci/structure-and-bundle-gates` | 与在途 CI 分支协调 |
| 5 | O3（`router.ts` 5 步拆分，每步一个 commit/PR） | `refactor/split-distribution-router` | 无（但建议在 4 之后，便于被守卫覆盖） |
| 6 | O5-2/3（catalog、分支清理） | `chore/dependency-hygiene` | 无 |
| 7 | O6（包级 build 语义 + 发布链路重复构建确认） | `chore/build-artifact-semantics` | 需先确认 Vercel 复用行为 |

约定：分支名遵循 `<category>/<kebab-case>`（禁止 `feat/`）；提交遵循 Conventional Commits；每个 PR 合并用 `gh pr merge --squash --delete-branch`。

---

## 5. 统一验收标准

每个交付前必须全绿（AGENTS.md 第 8 条）：

```sh
pnpm lint        # oxlint + prettier + lint:structure + cargo fmt/clippy
pnpm test        # workspace vitest + test:release + test:structure
pnpm typecheck
```

额外项（按 O 编号）：

- O1：`pnpm --filter @md-editor/web build` 后核对 katex chunk 字节/哈希并记录；浏览器请求断言（无公式不请求 katex）；`pnpm why katex` 单版本；`mermaid` 数学图回归；`desktop test:quicklook` 不回归。
- O2：三 app 的 resolver 测试 + alias-free fallback 测试通过；三 app `vite build` 通过；冷启动 dev smoke 通过。
- O3：worker `build/typecheck/test` + `pnpm lint:structure`；`router.ts` <800 行且豁免已从两份清单移除。
- O4：新增门禁在 PR 上实际触发并失败可见（用一次故意引入的反例验证）。
- O5：`pnpm install --frozen-lockfile` 后三 app 构建通过（不再依赖隐式提升）。

---

## 6. 风险、回滚与未决问题

**风险与回滚**
- 取消 katex 预加载会让**首次出现公式**时多一次异步加载（可能短暂占位/布局变化）。P0 与 P1 分开交付：P0 出问题单独回退 P0；override 出问题撤销 override 并恢复双版本，保留已验证的 P0。
- alias 裁剪若在 optimizeDeps 层面引发问题，按 app/条目回滚，不需要改包 API。
- `router.ts` 分步交付，任何一步失败可单独回退该步。

**未决问题（需确认后才实施）**
1. 在途分支 `ci/split-validation-and-macos-build` 与本方案的先后关系（决定 O4 的落点与 diff 形态）。
2. `apps/site` 的 CSS 惰性化是否能在 `next build` 下按需加载（需实证）。
3. `apps/mobile/core` 的同步 compiler 路径是否纳入"首屏无 KaTeX"目标（当前明确排除，需确认）。
4. `apps/mobile/core` 的 8 条 alias 是否纳入 O2（建议单列）。
5. mermaid 11.17 + katex 0.18.6 的运行时兼容性只能靠回归证明，本地类型声明不足以定论。
6. 是否采纳在途 CI 拆分分支：它补齐了 `lint:structure`，但同时**去掉 Browser E2E、把 Rust 三平台 matrix 收敛为单 Ubuntu**；取舍需产品侧确认。
7. “web/utools 测试最薄”目前是**基于文件/用例数的推断**，仓库没有 coverage 配置（`vitest.config.ts` 无 coverage 段），也不是 `git ls-files` 口径的分组统计；若要作为排期依据，需先建立 tracked 基线 + coverage 报告（见 O6 后续）。

---

## 附录 A：本次检索证据索引

- KaTeX 双版本归因：`node_modules/.pnpm/mermaid@11.17.2/node_modules/mermaid/package.json`（`katex: ^0.16.47`）、`packages/syntax-plugins/package.json:25`、`packages/compiler/package.json:18`、`apps/mobile/core/package.json:21`、`apps/site/package.json:23`。
- 首屏副作用：`packages/syntax-plugins/src/math/math-loader.ts:12-35`、`packages/syntax-plugins/src/index.ts`（`./math/index.ts` re-export 收尾于第 20 行）、`packages/syntax-plugins/src/math/math-projection.ts:42-58,125-140`。
- CSS 幽灵依赖：5 处 `styles.css:2` / `globals.css:2`；`apps/{desktop,web,utools}/package.json` 无 `katex`。
- mermaid 调用面：`.../mermaid/dist/chunks/mermaid.core/chunk-DU6HZSFF.mjs:5212-5245`。
- 探针：`apps/desktop/scripts/code-language-bundle-probe.mjs:25-49,75-101`（零引用；当前运行失败）。
- 配置：`apps/web/vite.config.ts:17-62`、`apps/desktop/vite.config.ts:19-56`、`apps/utools/vite.config.ts:61-86`、`apps/mobile/core/vite.config.ts`、`apps/site/next.config.ts:15-23`、`packages/editor-ui/tsconfig.json`。
- 结构守卫：`scripts/structure/check.mjs:24-33,74-93,257-279,320-329,480-502`、`structure-exceptions.json`、`scripts/structure/exceptions.baseline.json`、`docs/agent/architecture/repo_structure_and_naming_conventions.md:57-70,90-99,108-131`。
- CI：`.github/workflows/build-desktop.yml`（job/step 结构）、`release-web.yml`（仅 tag）、`release-utools.yml:63`、`build-site.yml`、`mobile-ci.yml`、`origin/ci/split-validation-and-macos-build:.github/workflows/ci.yml`。
- 性能基础设施：`packages/renderer-codemirror/src/diagnostics.ts`、`tests/wysiwyg/code-block-performance.test.ts`、`apps/desktop/e2e/codemirror-m2-code-block-performance.spec.ts`、`apps/tui/tests/perf-guard.test.ts`（在途分支）、`docs/agent/status/codemirror_renderer_migration_status.md`（S6 未开始）。
