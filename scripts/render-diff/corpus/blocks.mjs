/**
 * @file blocks.mjs
 * @description 块级语法语料：标题 ID / 列表 / 表格 / 代码块 / 引用块。
 *
 * 守护契约（对应 heading-ids / heading-alias-uniqueness / nested-heading-uniqueness /
 * outline-export-parity / render-html 五份测试）：
 * - GitHub 语义 slug：小写折叠、丢弃 Unicode 标点、空白→`-`、**保留** `_` 与 `-`；
 * - 重复标题依次加 `-1`、`-2`（第一个不加后缀），且去重依据是**最终 id**而非原始 slug；
 * - legacy 别名（兜底旧链接）仅在与新 id 不同且不冲突时输出，全文档内每个别名只出现一次；
 * - 列表项 / 引用块 / callout 内的嵌套标题**同样占 ID**，参与去重与别名冲突判定，
 *   但**不进大纲**；
 * - 代码围栏内的 `# xxx` 既不是标题也不占 ID。
 *
 * 全部按 byte 比较：标题 ID 与别名完全由我们控制，必须逐字节一致。
 */

export const BLOCKS_FIXTURES = [
  // ---------------------------------------------------------------------------
  // 标题 ID 基础
  // ---------------------------------------------------------------------------
  {
    id: "heading-basic-ids",
    mode: "byte",
    guards: "heading-ids: 基本 slug 规则",
    markdown: ["# Hello World", "", "## 你好 世界", "", "### Mixed 中英 Title"].join("\n"),
  },
  {
    id: "heading-keeps-underscore",
    mode: "byte",
    guards: "heading-ids: 保留下划线，`#snake_case` 不断链",
    markdown: ["# snake_case_function", "", "[跳到 snake_case](#snake_case_function)"].join("\n"),
  },
  {
    id: "heading-non-latin-non-empty",
    mode: "byte",
    guards: "heading-ids: 俄文/日文/韩文产出非空且唯一 id",
    markdown: ["# Тестовые процедуры", "", "# テスト手順", "", "# 한국어 절차"].join("\n"),
  },
  {
    id: "heading-duplicate-suffixes",
    mode: "byte",
    guards: "heading-ids: 重复标题加 -1 / -2，第一个不加后缀",
    markdown: ["# A", "", "# A", "", "# A"].join("\n"),
  },
  {
    id: "heading-duplicate-final-id-collision",
    mode: "byte",
    guards: "heading-ids: 去重依据是最终 id（A / A / A-1 不得产出两个 a-1）",
    markdown: ["# A", "", "# A", "", "# A-1"].join("\n"),
  },
  {
    id: "heading-strips-inline-syntax",
    mode: "byte",
    guards: "heading-ids: 剥掉行内语法与 HTML 标签后取可见文本",
    markdown: [
      "# **加粗** 与 *斜体* 与 `代码`",
      "",
      "# 带 <span>HTML</span> 标签",
      "",
      "# [链接文字](https://example.com) 标题",
    ].join("\n"),
  },
  {
    id: "heading-punctuation-dropped",
    mode: "byte",
    guards: "heading-ids: 丢弃 Unicode 标点与符号",
    markdown: ["# 标题：冒号？问号！感叹号", "", "# 标题 ➔ 箭头 （括号）"].join("\n"),
  },
  {
    id: "heading-pure-symbol-falls-back",
    mode: "byte",
    guards: "heading-ids: 纯符号标题走 legacy 兜底，不产出空 id",
    markdown: ["# ➔➔➔", "", "# ？？？"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // legacy 别名冲突
  // ---------------------------------------------------------------------------
  {
    id: "heading-alias-shared-suffix",
    mode: "byte",
    guards: "heading-alias-uniqueness: 同尾标题只输出一次别名",
    markdown: ["## テスト手順", "", "## ガイド手順", "", "## 補足手順"].join("\n"),
  },
  {
    id: "heading-alias-yields-to-real-id",
    mode: "byte",
    guards: "heading-alias-uniqueness: 别名与另一标题真实 id 同名时让位",
    markdown: ["## テスト手順", "", "## 手順"].join("\n"),
  },
  {
    id: "heading-alias-self-identical-skipped",
    mode: "byte",
    guards: "heading-anchor-contract: 别名与自身 id 相同时不输出",
    markdown: ["# Intro", "", "# plain"].join("\n"),
  },
  {
    id: "heading-alias-no-conflict-unchanged",
    mode: "byte",
    guards: "heading-alias-uniqueness: 无冲突时不误删可用别名",
    markdown: ["# 独立标题", "", "# 另一个标题"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // 嵌套标题（占 ID 但不进大纲）
  // ---------------------------------------------------------------------------
  {
    id: "heading-nested-in-list",
    mode: "byte",
    guards: "nested-heading-uniqueness: 列表项内的标题共享文档级分配器",
    markdown: ["# A", "", "- # A", "", "  - # A", "", "- 普通列表项"].join("\n"),
  },
  {
    id: "heading-nested-in-blockquote",
    mode: "byte",
    guards: "nested-heading-uniqueness: 引用块内标题参与别名冲突判定",
    markdown: ["# テスト手順", "", "> # 手順"].join("\n"),
  },
  {
    id: "heading-nested-in-callout",
    mode: "byte",
    guards: "nested-heading-uniqueness: callout 内标题算进真实 id 集合",
    markdown: ["# テスト手順", "", ":::warning", "# 手順", ":::"].join("\n"),
  },
  {
    id: "heading-nested-deep-list",
    mode: "byte",
    guards: "nested-heading-uniqueness: 多层嵌套列表里的标题也参与判定",
    markdown: ["# テスト手順", "", "- 一级", "  - 二级", "    - # 手順"].join("\n"),
  },
  {
    id: "heading-fence-suppresses-ids",
    mode: "byte",
    guards: "outline-export-parity: 围栏内的标题不出现在导出里，也不占 ID",
    markdown: ["# 真实标题", "", "```markdown", "# 围栏内的假标题", "```", "", "# 真实标题"].join(
      "\n",
    ),
  },
  {
    id: "heading-outline-parity-mixed",
    mode: "byte",
    guards: "outline-export-parity: 围栏 + 重复标题混合文档，大纲 id 全在导出 HTML 中",
    markdown: [
      "# はじめに",
      "",
      "```js",
      "# not a heading",
      "```",
      "",
      "# はじめに",
      "",
      "- # はじめに",
      "",
      "> # はじめに",
    ].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // 列表
  // ---------------------------------------------------------------------------
  {
    id: "list-ordered-and-unordered",
    mode: "byte",
    guards: "render-html: 有序/无序列表与嵌套",
    markdown: [
      "- 第一项",
      "- 第二项",
      "  - 嵌套 2.1",
      "  - 嵌套 2.2",
      "",
      "1. 步骤一",
      "2. 步骤二",
      "   1. 子步骤",
    ].join("\n"),
  },
  {
    id: "list-task-with-checkboxes",
    mode: "byte",
    guards: "render-html: GFM task list 输出 disabled checkbox 且不重复 [x] 文本",
    markdown: ["- [ ] 未完成项", "- [x] 已完成项", "- [X] 大写已完成"].join("\n"),
  },
  {
    id: "list-loose-and-tight",
    mode: "byte",
    guards: "render-html: 紧凑列表与松散列表的段落包装差异",
    markdown: ["- 紧凑一", "- 紧凑二", "", "- 松散一", "", "- 松散二"].join("\n"),
  },
  {
    id: "list-with-code-fence-inside",
    mode: "byte",
    guards: "render-html: 列表项内的围栏代码块与缩进围栏边界",
    markdown: ["- 列表项", "  ```js", "  const a = 1;", "  ```", "- 下一项"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // 表格
  // ---------------------------------------------------------------------------
  {
    id: "table-basic",
    mode: "byte",
    guards: "render-html: GFM 表格基础渲染",
    markdown: ["| 列 A | 列 B |", "| --- | --- |", "| a1 | b1 |", "| a2 | b2 |"].join("\n"),
  },
  {
    id: "table-alignment",
    mode: "byte",
    guards: "render-html: 表格对齐（左/中/右）",
    markdown: ["| 左 | 中 | 右 |", "| :-- | :-: | --: |", "| 1 | 2 | 3 |"].join("\n"),
  },
  {
    id: "table-inline-syntax-in-cells",
    mode: "byte",
    guards: "render-html: 单元格内的行内语法与转义管道",
    markdown: [
      "| 语法 | 示例 |",
      "| --- | --- |",
      "| 加粗 | **bold** |",
      "| 代码 | `a\\|b` |",
      "| 链接 | [x](https://example.com) |",
    ].join("\n"),
  },
  {
    id: "table-uneven-cells",
    mode: "byte",
    guards: "render-html: 表格列数不齐时的补齐行为",
    markdown: ["| A | B | C |", "| --- | --- |", "| 1 |", "| 1 | 2 | 3 | 4 |"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // 代码块
  // ---------------------------------------------------------------------------
  {
    id: "code-fence-basic-languages",
    mode: "byte",
    guards: "render-html: 多语言代码块高亮结构",
    markdown: [
      "```javascript",
      "const x = 1;",
      "```",
      "",
      "```python",
      "def f():",
      "    return 1",
      "```",
      "",
      "```rust",
      "fn main() {}",
      "```",
    ].join("\n"),
  },
  {
    id: "code-fence-alias-language",
    mode: "byte",
    guards: "render-html: 语言别名解析（js/ts/py/rs 等）",
    markdown: ["```js", "const a = 1;", "```", "", "```ts", "const b: number = 1;", "```"].join(
      "\n",
    ),
  },
  {
    id: "code-fence-unknown-language",
    mode: "byte",
    guards: "render-html: 未知语言的兜底（不覆盖显式标识、不自动检测）",
    markdown: "```not-a-real-language\nsome text\n```",
  },
  {
    id: "code-fence-no-language",
    mode: "byte",
    guards: "render-html: 无语言标识时的自动检测回退",
    markdown: "```\nplain text without language\n```",
  },
  {
    id: "code-fence-preserves-content",
    mode: "byte",
    guards: "render-html: 代码内容原样保留（含 HTML 标签与 markdown 语法）",
    markdown: '```html\n<div class="x"># not heading **not bold**</div>\n```',
  },
  {
    id: "code-fence-tilde-and-indent",
    mode: "byte",
    guards: "render-html: ~~~ 围栏与缩进代码块",
    markdown: ["~~~", "tilde fence", "~~~", "", "    indented code block"].join("\n"),
  },

  // ---------------------------------------------------------------------------
  // 引用块与分隔线
  // ---------------------------------------------------------------------------
  {
    id: "blockquote-nested",
    mode: "byte",
    guards: "render-html: 嵌套引用块",
    markdown: ["> 一级引用", ">", "> > 二级引用", ">", "> 回到一级"].join("\n"),
  },
  {
    id: "blockquote-with-block-content",
    mode: "byte",
    guards: "render-html: 引用块内的代码/列表/标题",
    markdown: ["> ```js", "> const a = 1;", "> ```", ">", "> - 列表项"].join("\n"),
  },
  {
    id: "thematic-break-forms",
    mode: "byte",
    guards: "render-html: 分隔符三种写法（前置段落避开 frontmatter 歧义）",
    markdown: ["段落。", "", "---", "", "***", "", "___"].join("\n"),
  },
];
