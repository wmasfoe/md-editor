# 独立无头编译器 (`@md-editor/compiler`) 架构规范

用途：记录 `@md-editor/compiler` 独立子包的设计初衷、架构分层、Token 数据模型（AST）、HTML 发射器、离线 KaTeX/Callout 渲染以及开放 `StaticCustomRenderer` 的设计规范。

---

## 1. 架构定位与第一性原理

在引入 `@md-editor/compiler` 之前，静态渲染与 HTML 导出逻辑混杂在 `packages/renderer-codemirror/src/static` 中。这造成了多维度的设计倒挂：
1. **依赖倒置**：`renderer-codemirror` 的核心职责是 Live 交互式 CodeMirror 6 编辑器引擎，而静态渲染只需要纯字符串变换，不应强行捆绑在沉重的编辑器引擎包中；
2. **环境受限**：macOS Finder QuickLook（通过 JavaScriptCore 运行）与移动端首屏预加载需要纯 Headless 运行环境（0 DOM、0 CM6 依赖）；
3. **能力收敛**：从第一性原理出发，将 Markdown/MDX 解析为结构化 Token 流并统一发射为高保真 HTML，是所有只读消费方（QuickLook、移动端阅读态、HTML 导出、打印、第三方扩展）的核心公共基石。

---

## 2. 模块拓扑与目录结构

```
packages/compiler/
├── package.json               # 声明 @md-editor/compiler，依赖 @md-editor/shared, katex, marked, highlight.js
├── tsconfig.json
├── src/
│   ├── index.ts               # 统一对外 API：compileToTokens, renderStaticHtml, renderStaticDocument
│   ├── tokens/
│   │   ├── types.ts           # 结构化 Token AST 类型（HeadingToken, CalloutToken, MathBlockToken 等）
│   │   └── index.ts
│   ├── parser/
│   │   └── tokenizer.ts       # 负责 Markdown -> StaticToken[] 转换，提取 Frontmatter 与 Title
│   ├── emitter/
│   │   ├── html-emitter.ts    # 负责 StaticToken[] -> 语义 HTML 发射
│   │   ├── custom-renderer.ts # 开放的 StaticCustomRenderer 拦截钩子接口
│   │   ├── math-render.ts     # 纯 JS 离线 KaTeX 公式渲染 (katex.renderToString)
│   │   └── highlight-code.ts  # highlight.js 代码着色
│   ├── data/
│   │   ├── callout-data.ts    # 纯数据层：Callout 矢量 SVG 图标与默认标题
│   │   └── language-names.ts  # 纯数据层：代码语言别名解析器
│   └── templates/
│       ├── document.ts        # 组装完整自包含 HTML 文档
│       └── styles.ts          # 内联 Light/Dark 模式 60+ 主题 CSS 变量与排版规则
└── tests/
    ├── compile-tokens.test.ts # Token 结构化抽取单测
    ├── render-html.test.ts    # HTML 渲染与 CustomRenderer 单测
    └── katex-offline.test.ts  # 无 DOM 环境 KaTeX 离线公式渲染单测
```

---

## 3. 核心 API 契约

### 3.1 结构化 Token 抽取：`compileToTokens`
```ts
export function compileToTokens(
  markdown: string,
  options?: TokenizeOptions,
): CompileResult;

export interface CompileResult {
  readonly tokens: StaticToken[];
  readonly title: string;
  readonly frontmatterRaw?: string;
}
```
调用方可获得与 marked/unified 类似但更加强类型的结构化 AST，便于进行大模型内容提取、目录索引或第三方排版。

### 3.2 高保真 HTML 渲染：`renderStaticHtml`
```ts
export function renderStaticHtml(
  markdown: string,
  options?: StaticRenderOptions,
): StaticRenderResult;
```
支持：
- `includeMarkers: boolean`（默认为 true，发射 `.cm-md-marker` 标签，完美对齐 `CodeMirrorEditor` 的弱化语法标记）；
- `customRenderer?: StaticCustomRenderer`（允许拦截或重写任意节点）。

### 3.3 离线独立 HTML 文档：`renderStaticDocument`
```ts
export function renderStaticDocument(
  markdown: string,
  options?: StaticDocumentOptions,
): string;
```
输出包含完整 `<!doctype html>`、内联 CSS（含 KaTeX 样式与主题变量）的单文件 HTML，供 QuickLook、导出与打印使用。

---

## 4. 零兼容性 Re-export 原则

严格遵守 `AGENTS.md` 规则 9：
- 抽取 `@md-editor/compiler` 后，彻底物理删除了 `packages/renderer-codemirror/src/static`；
- 旧调用方（`build-quicklook-engine.mjs`、`apps/mobile/core`、单元测试）100% 直连新包 `@md-editor/compiler`；
- 杜绝为了历史向后兼容保留任何空壳 re-export 转发文件。
