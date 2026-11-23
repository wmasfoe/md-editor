# Markdown 渲染核心架构规范（TS `@md-editor/compiler` + Rust `md-render`）

用途：记录 Markdown → HTML 渲染的**双实现**边界、各自职责、等价性契约与差分测试守门机制。

> **重要**：仓库长期存在**两套**渲染实现，这是**终态**而非过渡态。
> 任何修改渲染行为的改动都必须同时通过 `scripts/render-diff` 的差分测试。

---

## 1. 为什么有两套实现

| 宿主 | 实现 | 原因 |
|---|---|---|
| **移动端**（iOS / Android WebView） | TS `@md-editor/compiler` | 无 Rust 运行时；WebView 内跑 JS |
| **桌面端**（Tauri 主窗口） | Rust `md-render` | 原生侧统一渲染语义，减少 JS↔Rust 往返 |
| **macOS QuickLook**（`.appex`） | Rust `md-render`（经 `md-render-ffi` 的 C ABI） | 扩展无 `allow-jit`，不能跑 WASM；原生机器码不受限 |

移动端不在迁移范围内，因此 **TS 实现永久保留**。既然两套实现都活着，一致性就不能靠人工纪律。

---

## 2. 双实现边界

```
                    Markdown 源码
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
  packages/compiler/                crates/render/
  （TS，移动端）                     （Rust，桌面 + QuickLook）
  marked + marked-cjk-friendly      comrak（仅解析）+ 自研 emitter
  highlight.js                      highlight.js（内嵌 QuickJS）
  katex                             katex（内嵌 QuickJS）
          │                               │
          └───────────────┬───────────────┘
                          ▼
              scripts/render-diff 差分测试
              （83 条语料，byte / semantic 双模式）
```

### 2.1 TS 侧：`packages/compiler`

保留完整的解析 → 发射 → 模板流水线，供移动端与任何纯 JS 环境使用：

```
packages/compiler/src/
├── index.ts               # compileToTokens / renderStaticHtml / renderStaticDocument
├── parser/tokenizer.ts    # marked + CJK 友好扩展 + math/highlight/directive 自定义 tokenizer
├── emitter/
│   ├── html-emitter.ts    # StaticToken[] → 语义 HTML（含 .cm-md-marker 标记）
│   ├── math-render.ts     # katex.renderToString
│   └── highlight-code.ts  # highlight.js
├── data/                  # callout 图标、语言别名（纯数据）
└── templates/             # document.ts（骨架）、styles.ts（约 400 行主题 CSS）
```

**`templates/` 是两份资产的唯一事实源**：Rust 侧在构建期从这里读取 CSS 与文档骨架（见 §3.3），不做手工复制。

### 2.2 Rust 侧：`crates/render`

```
crates/render/
├── build.rs               # 构建期从 node_modules 与 packages/compiler 提取资产
└── src/
    ├── lib.rs             # render_html / render_document 入口
    ├── emit.rs            # comrak AST → IR → HTML（逐字节对齐 TS emitter）
    ├── slug.rs            # 标题 ID / 去重 / legacy 别名（移植 @md-editor/shared）
    ├── directive.rs       # :::容器 分段（comrak 无此语法）
    ├── callout.rs         # callout 图标 SVG（移植 packages/plugin-sdk/callout-data.ts）
    ├── math.rs            # 经 QuickJS 调用 katex.renderToString
    ├── highlight.rs       # 经 QuickJS 调用 hljs.highlight + 语言别名表
    ├── js_runtime.rs      # QuickJS 单例运行时（每线程一份）
    ├── document.rs        # standalone 文档包装
    └── escape.rs          # HTML 转义（与 TS escapeHtml 逐字符一致）
```

**关键设计：comrak 只用于解析。** 它内置的 HTML 渲染器产不出 `cm-md-marker` 标记，也无法复刻本项目的标题 ID / legacy 别名规则，因此 HTML 由 `emit.rs` 手写发射。

---

## 3. 三个「同一份资产」原则

Rust 侧不复制 JS 实现，而是在**构建期**读取同一份源，从根上消除漂移。

### 3.1 数学与代码高亮：内嵌 QuickJS

| 能力 | 为什么不能 Rust 原生重写 |
|---|---|
| 数学（KaTeX） | 输出结构复杂（多层 `<span class="katex-*">` + 内联 style），Rust 移植无法保证一致；改用 MathML 会破坏「编辑器所见 = 导出所得」 |
| 代码高亮（highlight.js） | 用**手写正则**分词并映射固定类名（`hljs-keyword`）；`syntect` 用 Sublime `.tmLanguage` 作用域栈，**分词边界本身就不同**，写类名映射表不够 |

因此直接跑**同一份 JS**：`build.rs` 从 `node_modules` 读取 `katex.min.js` 与 `highlight.js`，用 QuickJS 执行。

- 版本**自动锁定**：升级 `pnpm` 依赖即生效，不需要手工同步版本号（`katex_version()` / `highlight_version()` 可在运行期断言）。
- QuickJS 是**纯解释器**，不需要 JIT，因此可在 App Sandbox 的 QuickLook 扩展里正常工作。
- `highlight.js` 的 `lib/index.js` 是 CommonJS（194 个 `require`），构建期用仓库已有的 esbuild（vite 传递依赖）打成 IIFE，不新增依赖。

### 3.2 语言别名表

`crates/render/src/highlight.rs` 的 `LANGUAGE_ALIASES` 与 `packages/compiler/src/data/language-names.ts` 的 `SUPPORTED_LANGUAGE_METAS` **逐字对齐**（含顺序——同一个 token 命中多条时取第一条）。

### 3.3 静态文档模板与 CSS

`crates/render/build.rs` 在构建期从 `packages/compiler/src/templates/` 提取 `STATIC_DOCUMENT_BASE_CSS` 与文档骨架，内联进 Rust 二进制。

提取时需还原 JS 模板字符串的转义（`\\p` → `\p`），否则内联脚本里的正则会多一层反斜杠。

---

## 4. 等价性契约与分级

`scripts/render-diff` 用同一份语料同时跑两个实现并对比。**每条 fixture 显式声明比较模式**：

| 模式 | 含义 | 适用 |
|---|---|---|
| `byte` | 逐字节一致 | 标题 ID/去重/legacy 别名、callout、`==highlight==`、代码高亮、KaTeX 公式、整体 HTML 骨架 |
| `semantic` | 规范化投影一致 | CJK 强调/删除线边界（comrak 的 `cjk_friendly_emphasis` 与 `marked-cjk-friendly` 是两套独立实现） |

`semantic` 的投影规则：属性排序、文本节点折叠空白并裁剪两端、**不放宽标签结构**（`<strong>` vs `<em>` 仍判失败）。

### 4.1 自收紧规则

避免「永久跳过」退化成永久漏测：

- `crates/render/Cargo.toml` **不存在** → 阶段 0，跳过 Rust 侧并显式报告
- 存在但渲染器跑不起来 → **测试失败**

### 4.2 语料

约 110 条，按关注点分组（`scripts/render-diff/corpus/`）：

| 文件 | 覆盖 |
|---|---|
| `inline-and-cjk.mjs` | 行内语法、CJK 邻接边界（7 条 semantic） |
| `blocks.mjs` | 标题 ID/去重/别名、嵌套标题、列表、表格、代码块、引用块 |
| `plugins.mjs` | GFM Alert、`:::容器`、`==highlight==`、数学、mermaid |
| `edge.mjs` | 空文档、frontmatter、围栏陷阱、组合文档；另含三组回归集：<br>`PARITY_GAP_FIXTURES`（首轮审计发现的 16 条缺口）<br>`REAL_WORLD_FIXTURES`（用仓库真实文档跑差分发现的 13 条边界）<br>`AUDIT_ROUND2_FIXTURES`（第二轮对抗性探测发现的 15 条，含嵌套锚点、定义行错位、相邻 `$$` 块、MDX 属性等） |

每条 fixture 必须声明 `mode` 与 `guards`（守护 `packages/compiler/tests/` 的哪条契约），否则 `validateCorpus` 失败。

### 4.3 真实文档全量验证

`scripts/render-diff/real-docs-parity.mjs` 用**仓库自己的全部 markdown 文档**
（当前 364 份）跑同一套差分。

为什么必须有它：人工构造的语料永远覆盖不到真实文档的写法。该脚本在初次迁移后
一次就发现 10 类分叉，全部不在原始语料里：

| 分叉 | 根因 |
|---|---|
| 标题 ID 在裸 `<` 处截断 | `strip_html_tags` 用深度计数器，孤立 `<` 让计数永久 >0 |
| fence info 带属性时高亮错误 | 只取 info 首词；TS 用整个 info string |
| `&copy;` 被解码为 `©` | comrak 解码实体，marked 不解码 |
| 松散任务列表丢 `[x]` 字面量 | marked 只在 tight 列表剥前缀 |
| 未知小写标签 HTML 块被转义 | comrak 只认 CommonMark blockTags 白名单 |
| BOM 后首行被识别为标题 | comrak 跳过 BOM，marked 不跳 |
| 引用定义行被吞掉 | comrak 消费为链接定义，marked 输出为可见文本 |
| `$$x$$` 行内形态 | comrak 识别为 display math，marked 按容器退化 |
| 行内代码 `:::info` 多空格 | 自定义扩展的 `start()` 命中行内位置 |
| `name@version` 未自动链接 | comrak 要求域名含 `.` 且 TLD 为字母 |

该脚本已纳入 `pnpm test:render-diff` 与 CI，退出码非 0 即失败。

**但「364/364」不等于完备**：第二轮审计用对抗性探测又找出 15 条真实分叉，
它们恰好没出现在仓库文档里。因此语料与真实文档**两者都必需**：

| 手段 | 覆盖 |
|---|---|
| fixture 语料（127 条） | 人工构造的边界与反例（裸 `<`、MDX 属性、嵌套锚点…） |
| 真实文档全量（364 份） | 实际写法与结构组合 |

第二轮修复的 15 条中最危险的两条会产生**非法 HTML**：

- 邮箱自动链接被重复包裹 → `<a href="mailto:x"><a href="mailto:x">…</a></a>`
  （嵌套锚点；且 `[a@b.com](url)` 会破坏链接目标）
- 链接定义行被提升到文档开头 → 可见文本错位到 H1 之前

修复方式：`emit_inlines_with(…, inside_link)` 传递链接上下文；定义行改为
「原位占位符 + 文档开头裸定义副本」（副本被 comrak 消费，不产生输出）。

### 4.4 与 `packages/compiler/tests/` 的关系

TS 侧的 11 个测试文件 / 130 个用例是**行为定义基线**。Rust 侧的等价性由差分测试保证——不是重写那 130 个用例，而是用同一批语料验证两个实现产出相同结果。

---

## 5. 宿主接入

### 5.1 桌面端（Tauri command）

`apps/desktop/src-tauri/src/render.rs`：

| 命令 | 用途 |
|---|---|
| `render_markdown_fragment` | 渲染 HTML 片段（富文本剪贴板） |
| `render_markdown_document` | 渲染完整 standalone 文档 |
| `render_markdown_document_from_fragment` | 把**已后处理**的片段包装成文档 |

**职责分工**（`apps/desktop/src/app/controller/export-controller.ts`）：

- **Rust**：Markdown → HTML（标题 ID、callout、highlight、代码高亮、数学公式）
- **宿主 JS**：mermaid → SVG、图片 → Data URL、字体/打印 CSS 拼装、文档包装

### 5.2 QuickLook（C ABI 静态库）

`crates/render-ffi` 导出 4 个符号：`md_render_document`、`md_render_fragment`、`md_render_free_string`、`md_render_katex_version`。Swift 侧用 `@_silgen_name` 声明并通过 `swiftc -lmd_render_ffi` 链接。

详见 [macOS Quick Look 预览扩展架构](./macos_quicklook_preview_architecture.md)。

---

## 6. Mermaid 契约（方式 a）

Rust 渲染核心**不感知 mermaid**：` ```mermaid ` 原样输出为 `<pre><code class="language-mermaid">`，由宿主用 `inlineMermaidSvg()` 替换为 SVG。

**不得**把 mermaidSvgs 映射塞进 Rust 入参——那会让 Rust 接口依赖宿主后处理结果，破坏「纯 `markdown -> html`」的边界。

---

## 7. 修改渲染行为时的检查清单

1. 改 TS 侧 → 跑 `pnpm --filter @md-editor/compiler test`（130 用例）
2. 改 Rust 侧 → 跑 `cargo test --manifest-path crates/render/Cargo.toml`
3. **无论改哪侧** → 跑 `pnpm test:render-diff`；若新增语法，先在 `corpus/` 加 fixture
4. 若两侧行为**有意**分叉 → 不能直接改 `semantic` 模式蒙混过关，必须在 fixture 的 `guards` 里说明理由

---

## 8. 零兼容性 Re-export 原则

严格遵守 `AGENTS.md`：
- 抽取子包后彻底物理删除旧实现，不留空壳 re-export；
- 桌面端不再依赖 `@md-editor/compiler`（已从 `apps/desktop/package.json` 移除）；
- 唯一保留的消费方是移动端 `apps/mobile/core/src/components/ReaderCanvas.tsx`。
