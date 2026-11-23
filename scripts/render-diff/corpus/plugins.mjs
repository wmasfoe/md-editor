/**
 * @file plugins.mjs
 * @description 语法插件语料：callout / container directive / ==highlight== / 数学 / mermaid。
 *
 * 守护契约（对应 render-html / katex-offline / callout-boundary 三份测试）：
 * - GFM Alert（`> [!NOTE]`）与 Container Directive（`:::tip [自定义标题]`）两套 callout 语法；
 * - callout 图标内联 SVG，`danger`/`caution` 的 X 用 `fill-rule="evenodd"` 切出；
 * - `==highlight==` 是 Typora/Obsidian 事实标准，comrak **无原生支持**，必须自实现；
 * - `:::type` 容器 comrak **无原生支持**（它的 `alerts` 是 `> [!NOTE]` 语法），必须自实现；
 * - 数学：行内 `$…$`、单行块 `$$…$$`、多行块、fenced ` ```math `，全部经 KaTeX 渲染
 *   并内联 KaTeX 生成的 HTML（离线可用，无 DOM 依赖）；
 * - mermaid：Rust 侧只输出 `<pre><code class="language-mermaid">`，
 *   SVG 由宿主后处理替换（本次迁移的既定契约）。
 */

export const PLUGINS_FIXTURES = [
  // ---------------------------------------------------------------------------
  // GFM Alert
  // ---------------------------------------------------------------------------
  {
    id: "alert-all-kinds",
    mode: "byte",
    guards: "render-html: GFM Alert 五种类型与默认标题",
    markdown: [
      "> [!NOTE]",
      "> 提示内容。",
      "",
      "> [!TIP]",
      "> 技巧内容。",
      "",
      "> [!IMPORTANT]",
      "> 重要内容。",
      "",
      "> [!WARNING]",
      "> 警告内容。",
      "",
      "> [!CAUTION]",
      "> 危险内容。",
    ].join("\n"),
  },
  {
    id: "alert-custom-title",
    mode: "byte",
    guards: "render-html: GFM Alert 自定义标题行",
    markdown: ["> [!TIP] 自定义标题", "> 正文内容。"].join("\n"),
  },
  {
    id: "alert-danger-evenodd-icon",
    mode: "byte",
    guards: "render-html: danger/caution 的 X 图标用 evenodd 切出",
    markdown: ["> [!CAUTION]", "> 必须用 evenodd 才能把 X 挖空。"].join("\n"),
  },
  {
    id: "alert-inner-blocks",
    mode: "byte",
    guards: "render-html: Alert 内的列表/代码/嵌套引用",
    markdown: [
      "> [!NOTE]",
      "> - 列表项",
      ">",
      "> ```js",
      "> const a = 1;",
      "> ```",
      ">",
      "> > 嵌套引用",
    ].join("\n"),
  },
  {
    id: "alert-via-directive-syntax",
    mode: "byte",
    guards: "render-html: `:::note` 与 GFM Alert 语义对齐",
    markdown: [":::note", "提示内容。", ":::"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // Container Directive
  // ---------------------------------------------------------------------------
  {
    id: "directive-all-types",
    mode: "byte",
    guards: "render-html: Container Directive 全类型",
    markdown: [
      ":::tip",
      "技巧。",
      ":::",
      "",
      ":::warning",
      "警告。",
      ":::",
      "",
      ":::danger",
      "危险。",
      ":::",
    ].join("\n"),
  },
  {
    id: "directive-custom-title",
    mode: "byte",
    guards: "render-html: `:::tip [自定义标题]`",
    markdown: [":::tip 这是我的标题", "正文内容。", ":::"].join("\n"),
  },
  {
    id: "directive-inner-blocks",
    mode: "byte",
    guards: "render-html: Directive 内的标题/列表/代码（内嵌标题占 ID）",
    markdown: [
      ":::warning 注意",
      "# 容器内标题",
      "",
      "- 列表项",
      "",
      "```js",
      "const a = 1;",
      "```",
      ":::",
    ].join("\n"),
  },
  {
    id: "directive-unclosed-falls-back",
    mode: "byte",
    guards: "render-html: 未闭合 directive 不得吞噬后续正文",
    markdown: [":::tip", "未闭合的容器", "", "# 后续标题", "", "后续正文。"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // ==highlight==
  // ---------------------------------------------------------------------------
  {
    id: "highlight-basic",
    mode: "byte",
    guards: "render-html: `==highlight==` 基础渲染",
    markdown: "这段话里 ==这是高亮== 其余是正文。",
  },
  {
    id: "highlight-boundaries",
    mode: "byte",
    guards: "render-html: highlight 的空白/等号边界反例",
    markdown: [
      "==开头高亮==后面",
      "前面==结尾高亮==",
      "==带 **加粗** 的嵌套==",
      "不是高亮：== 前后有空格 ==",
      "a==b==c 词内形式",
    ].join("\n\n"),
  },

  // ---------------------------------------------------------------------------
  // 数学（KaTeX，必须 byte 级一致）
  // ---------------------------------------------------------------------------
  {
    id: "math-inline",
    mode: "byte",
    guards: "katex-offline: 行内公式无 DOM 依赖渲染",
    markdown: "质能方程 $E = mc^2$ 与 $a^2 + b^2 = c^2$ 都在同一段。",
  },
  {
    id: "math-display-block",
    mode: "byte",
    guards: "katex-offline: 块级公式 displayMode",
    markdown: ["$$", "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}", "$$"].join("\n"),
  },
  {
    id: "math-single-line-block",
    mode: "byte",
    guards: "katex-offline: 单行独立 $$...$$ 必须整行独占",
    markdown: ["$$E=mc^2$$", "", "后续段落。"].join("\n"),
  },
  {
    id: "math-fenced-latex",
    mode: "byte",
    guards: "katex-offline: ```latex / ```math 围栏公式块",
    markdown: ["```latex", "\\frac{a}{b}", "```"].join("\n"),
  },
  {
    id: "math-complex-environments",
    mode: "byte",
    guards: "katex-offline: align/cases/matrix 等复杂环境",
    markdown: [
      "$$",
      "\\begin{aligned}",
      "a &= b + c \\\\",
      "d &= e - f",
      "\\end{aligned}",
      "$$",
      "",
      "$$",
      "f(n) = \\begin{cases} n/2 & \\text{if } n \\text{ is even} \\\\ 3n+1 & \\text{if } n \\text{ is odd} \\end{cases}",
      "$$",
    ].join("\n"),
  },
  {
    id: "math-malformed-graceful",
    mode: "byte",
    guards: "katex-offline: 畸形公式走错误兜底而非抛错",
    markdown: "坏公式：$\\frac{1}{$ 与 $\\unknowncommand{x}$ 混排。",
  },
  {
    id: "math-currency-not-math",
    mode: "byte",
    guards: "katex-offline: `$100 and $200` 货币场景不被误判为公式",
    markdown: "价格是 $100 和 $200，不是公式。",
  },
  {
    id: "math-escaped-dollar",
    mode: "byte",
    guards: "katex-offline: `\\$` 转义不被当作公式起始",
    markdown: "转义美元符 \\$5 与真正的公式 $x$ 并存。",
  },

  // ---------------------------------------------------------------------------
  // mermaid（Rust 侧只输出代码块，SVG 由宿主后处理）
  // ---------------------------------------------------------------------------
  {
    id: "mermaid-left-as-code-block",
    mode: "byte",
    guards: "既定契约：mermaid 在 Rust 侧原样输出为 language-mermaid 代码块",
    markdown: ["```mermaid", "graph TD", "  A --> B", "```"].join("\n"),
  },
  {
    id: "mermaid-not-auto-detected",
    mode: "byte",
    guards: "render-html: 显式 mermaid 语言标识不被自动检测覆盖",
    markdown: ["```mermaid", "sequenceDiagram", "  A->>B: hi", "```"].join("\n"),
  },
];
