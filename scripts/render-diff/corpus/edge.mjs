/**
 * @file edge.mjs
 * @description 边界与整体文档语料：空文档 / frontmatter / 组合文档 / 围栏陷阱 / 大文档。
 *
 * 守护契约（对应 compile-tokens / render-html / html-export 三份测试）：
 * - 空文档与纯空白文档不得抛错，输出既定占位内容；
 * - frontmatter 必须在文档偏移 0，未闭合时按未闭合语义降级；
 * - 静态文档（standalone）需内联主题样式、字体栈、打印样式与锚点跳转脚本；
 * - 围栏边界：列表项内的收尾围栏不得被误判为新的开启围栏（曾把后续正文全吞进围栏）；
 * - 组合文档用于差分测试的整体回归，任何一处偏差都会在这里暴露。
 */

export const EDGE_FIXTURES = [
  {
    id: "empty-document",
    mode: "byte",
    guards: "render-html / compile-tokens: 空文档安全",
    markdown: "",
  },
  {
    id: "whitespace-only-document",
    mode: "byte",
    guards: "render-html: 纯空白文档",
    markdown: "   \n\n\t\n  ",
  },
  {
    id: "frontmatter-at-offset-zero",
    mode: "byte",
    guards: "compile-tokens / render-html: frontmatter 在偏移 0 被提取",
    markdown: [
      "---",
      "title: 文档标题",
      "tags: [a, b]",
      "---",
      "",
      "# 正文标题",
      "",
      "正文。",
    ].join("\n"),
  },
  {
    id: "frontmatter-unterminated",
    mode: "byte",
    guards: "render-html: 未闭合 frontmatter 的降级语义",
    markdown: ["---", "title: 未闭合", "", "# 正文标题"].join("\n"),
  },
  {
    id: "fence-inside-list-item-closing",
    mode: "byte",
    guards: "render-html: 列表项内收尾围栏不得被误判为开启围栏（吞正文回归）",
    markdown: [
      "- 列表项",
      "  ```js",
      "  const a = 1;",
      "  ```",
      "",
      "# 围栏之后的标题",
      "",
      "围栏之后的正文必须仍然可见。",
    ].join("\n"),
  },
  {
    id: "fence-inside-blockquote-closing",
    mode: "byte",
    guards: "render-html: 引用块内围栏闭合",
    markdown: ["> ```js", "> const a = 1;", "> ```", "", "# 之后的标题"].join("\n"),
  },
  {
    id: "fence-unclosed-runs-to-eof",
    mode: "byte",
    guards: "render-html: 未闭合围栏按 CommonMark 包含到文档结尾",
    markdown: ["# 标题", "", "```js", "const a = 1;", "", "仍然是代码"].join("\n"),
  },
  {
    id: "mdx-block-lowercase-tag-not-mdx",
    mode: "byte",
    guards: "render-html: 小写标签不识别为 MDX 组件",
    markdown: "<div>\n普通 HTML 块\n</div>",
  },
  {
    id: "mdx-block-uppercase-tag",
    mode: "byte",
    guards: "render-html: 大写 JSX 标签保留为源码块不执行",
    markdown: '<Callout type="tip">\n组件内容\n</Callout>',
  },
  {
    id: "crlf-line-endings",
    mode: "byte",
    guards: "render-html: CRLF 行尾归一化",
    markdown: "# 标题\r\n\r\n正文段落。\r\n",
  },
  {
    id: "no-trailing-newline",
    mode: "byte",
    guards: "render-html: 文档结尾无换行",
    markdown: "# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
  },
  {
    id: "combined-realistic-document",
    mode: "byte",
    guards: "整体回归：真实文档组合全部语法",
    markdown: [
      "---",
      "title: 综合回归文档",
      "---",
      "",
      "# 一级标题",
      "",
      "引言段落，包含 **加粗**、*斜体*、`代码`、[链接](https://example.com) 与 $E=mc^2$。",
      "",
      "## 列表与任务",
      "",
      "- [x] 已完成",
      "- [ ] 待完成",
      "  - 嵌套项",
      "",
      "## 表格",
      "",
      "| 名称 | 值 |",
      "| :-- | --: |",
      "| a | 1 |",
      "| b | 2 |",
      "",
      "## 代码",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "## 提示块",
      "",
      "> [!NOTE]",
      "> 这是一个提示。",
      "",
      ":::warning 自定义",
      "容器内 ==高亮== 文本。",
      ":::",
      "",
      "## 公式",
      "",
      "$$",
      "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
      "$$",
      "",
      "## 图表",
      "",
      "```mermaid",
      "graph LR",
      "  A --> B",
      "```",
      "",
      "> 引用块结尾。",
    ].join("\n"),
  },
];

/**
 * 审计发现的对齐缺口回归集。
 *
 * 这些场景在初次迁移时**完全不在语料里**，导致字节级类别（标题 ID、
 * 代码高亮结构）的分叉静默上线。每条都对应一个已修复的真实缺陷。
 */
export const PARITY_GAP_FIXTURES = [
  {
    id: "heading-with-bare-less-than",
    mode: "byte",
    guards: "heading-ids: 标题含孤立 `<` 时 id 与 data-heading-text 不得被截断",
    markdown: "# 性能 < 10ms 的场景",
  },
  {
    id: "heading-bare-less-than-simple",
    mode: "byte",
    guards: "heading-ids: 极简 `<` 标题（a < b）的 id 与 legacy 别名",
    markdown: "# a < b",
  },
  {
    id: "heading-html-tag-stripped",
    mode: "byte",
    guards: "heading-ids: 成对 HTML 标签被剥除，孤立 `<` 保留",
    markdown: "# 带 <span>标签</span> 与 < 符号",
  },
  {
    id: "fence-info-string-attributes",
    mode: "byte",
    guards: "代码高亮结构: info string 带属性时不解析别名、不做高亮、class 原样保留",
    markdown: '```js title="demo.js"\nconst a = 1;\n```',
  },
  {
    id: "fence-info-string-braces",
    mode: "byte",
    guards: "代码高亮结构: info string 带行号范围（{1,3}）时的 class 与高亮行为",
    markdown: "```ts {1,3}\nconst a = 1;\n```",
  },
  {
    id: "fence-info-string-linenums",
    mode: "byte",
    guards: "代码高亮结构: info string 带 linenums 属性",
    markdown: '```python linenums="1"\ndef f():\n    return 1\n```',
  },
  {
    id: "entity-named-copy",
    mode: "byte",
    guards: "文本转义: 具名实体不解码（TS 输出字面量 &copy;）",
    markdown: "版权 &copy; 2026",
  },
  {
    id: "entity-nbsp",
    mode: "byte",
    guards: "文本转义: &nbsp; 不解码为不换行空格",
    markdown: "a&nbsp;b",
  },
  {
    id: "entity-in-heading",
    mode: "byte",
    guards: "文本转义: 标题内的实体不参与 slug 解码",
    markdown: "# a &amp; b",
  },
  {
    id: "task-list-loose",
    mode: "byte",
    guards: "render-html: 松散任务列表保留 [x] 字面量与 input 后空格",
    markdown: "- [x] a\n\n- [x] b",
  },
  {
    id: "task-list-loose-mixed",
    mode: "byte",
    guards: "render-html: 松散任务列表混排未完成项与续行",
    markdown: "- [x] a\n\n  continued\n\n- [ ] b",
  },
  {
    id: "html-block-unknown-tag",
    mode: "byte",
    guards: "render-html: 未知小写标签的 HTML 块整块透传且不破坏块内列表",
    markdown: "<use_when>\n- 场景\n</use_when>",
  },
  {
    id: "html-block-unknown-tag-attrs",
    mode: "byte",
    guards: "render-html: 未知标签带属性时的 HTML 块透传",
    markdown: '<custom_block type="tip">\n**内容**\n</custom_block>',
  },
  {
    id: "bom-before-heading",
    mode: "byte",
    guards: "render-html: BOM 后的首行按普通段落处理，不被识别为标题",
    markdown: "\uFEFF# Title\n\nbody",
  },
  {
    id: "reference-definition-visible",
    mode: "byte",
    guards: "render-html: 引用定义行作为可见文本输出，同时引用仍能解析",
    markdown: "[foo]: https://example.com\n\n[foo]",
  },
  {
    id: "reference-definition-alone",
    mode: "byte",
    guards: "render-html: 孤立引用定义行的可见输出",
    markdown: "[foo]: https://example.com",
  },
];

/**
 * 真实仓库文档暴露的边界集（审计发现）。
 *
 * 这些场景在初次迁移时不在语料里，是「拿仓库自己的 364 份 markdown 跑差分」
 * 才发现的分叉。全部来自真实文档结构，比人工构造的用例更能反映用户实际导出。
 */
export const REAL_WORLD_FIXTURES = [
  {
    id: "real-inline-dollar-in-paragraph",
    mode: "byte",
    guards: "数学: 段落内的 `$$x$$` 按字面量输出（非块级公式）",
    markdown: "标签中的 $$...$$ 渲染为 katex 标记且无降级文案",
  },
  {
    id: "real-inline-dollar-in-list",
    mode: "byte",
    guards: "数学: 列表项内的 `$$x$$` 退化为 `$` + 行内数学 + `$`",
    markdown: "- a $$b$$ c",
  },
  {
    id: "real-inline-dollar-in-blockquote",
    mode: "byte",
    guards: "数学: 引用块内的 `$$x$$` 与段落一致（字面量 + 换行）",
    markdown: "> a $$b$$ c",
  },
  {
    id: "real-inline-code-double-colon",
    mode: "byte",
    guards: "行内代码: `:::info` 不被 directive 扩展误切分",
    markdown: "类似 `:::info` 的块级容器指令",
  },
  {
    id: "real-html-comment-then-code-fence",
    mode: "byte",
    guards: "HTML 块: 注释后紧邻代码围栏时保留换行",
    markdown: "<!-- readme-check -->\n```typescript\nconst a = 1;\n```",
  },
  {
    id: "real-html-comment-blank-then-code",
    mode: "byte",
    guards: "HTML 块: 注释后空行再跟代码围栏时去掉换行",
    markdown: "<!-- readme-check -->\n\n```typescript\nconst a = 1;\n```",
  },
  {
    id: "real-unknown-tag-block-with-blank-line",
    mode: "byte",
    guards: "HTML 块: 含空行的未知标签块只透传开标签行，块内 Markdown 正常解析",
    markdown: "<x_tag>\nintro text.\n\n## Section\n\n- item\n</x_tag>",
  },
  {
    id: "real-unknown-tag-block-compact",
    mode: "byte",
    guards: "HTML 块: 无空行的未知标签块整块透传",
    markdown: "<use_when>\n- 场景\n</use_when>",
  },
  {
    id: "real-reference-definition-with-usage",
    mode: "byte",
    guards: "引用定义: 定义行作为可见文本输出，同时 `[foo]` 仍解析为链接",
    markdown: "[foo]: https://example.com\n\nSee [foo] for details.",
  },
  {
    id: "real-task-list-loose-with-continuation",
    mode: "byte",
    guards: "任务列表: 松散列表保留 [x] 字面量与续行段落",
    markdown: "- [x] done\n\n  continued text\n\n- [ ] todo",
  },
  {
    id: "real-entity-in-body-text",
    mode: "byte",
    guards: "文本转义: 正文里的具名实体不解码",
    markdown: "版权 &copy; 2026 与 a&nbsp;b",
  },
  {
    id: "real-bom-document",
    mode: "byte",
    guards: "文档: BOM 后首行按段落处理",
    markdown: "\uFEFF# Title\n\nbody text",
  },
  {
    id: "real-npm-scoped-package-autolink",
    mode: "byte",
    guards: "自动链接: `name@version` 形式识别为 mailto 链接",
    markdown: "Updated dependencies: sanitize-html@2.17.6",
  },
];

/**
 * 审计第二轮发现的对齐缺口（全部已修复）。
 *
 * 这些场景的共同点：初次迁移的语料里完全没有，`real-docs-parity` 也覆盖不到
 * （仓库文档里恰好没出现），因此只能靠对抗性探测发现。
 * 每条都对应一个真实缺陷，且大部分会产生**非法 HTML**或**内容错位**。
 */
export const AUDIT_ROUND3_FIXTURES = [
  {
    id: "email-autolink-in-paragraph",
    mode: "byte",
    guards: "自动链接: 段落内的邮箱不得被重复包裹成嵌套锚点",
    markdown: "联系 a@b.com 获取支持",
  },
  {
    id: "email-autolink-inside-link",
    mode: "byte",
    guards: "自动链接: 链接内部不得再生成 `<a>`（非法嵌套锚点）",
    markdown: "[a@b.com](https://x.com)",
  },
  {
    id: "email-autolink-inside-strong",
    mode: "byte",
    guards: "自动链接: 强调内部的邮箱同样不得嵌套",
    markdown: "**a@b.com** 与 *c@d.org*",
  },
  {
    id: "email-autolink-in-table-cell",
    mode: "byte",
    guards: "自动链接: 表格单元格内的邮箱",
    markdown: "| 联系人 |\n| --- |\n| a@b.com |",
  },
  {
    id: "footnote-definition-in-place",
    mode: "byte",
    guards: "定义行: 脚注定义 `[^1]:` 原位输出，不得被提升到文档开头",
    markdown: "# 发布说明\n\n感谢 alice\n\n[^1]: 在 M2 完成",
  },
  {
    id: "link-definition-in-place",
    mode: "byte",
    guards: "定义行: 链接定义原位输出可见文本，同时 `[foo]` 仍解析",
    markdown: "# 标题\n\n正文\n\n[foo]: https://example.com\n\n见 [foo]",
  },
  {
    id: "math-adjacent-display-blocks",
    mode: "byte",
    guards: "数学: 相邻的两个 `$$` 块各自成为块级公式（不得退化为行内）",
    markdown: "$$\na\n$$\n$$\nb\n$$",
  },
  {
    id: "math-multiline-inline-is-literal",
    mode: "byte",
    guards: "数学: 跨行的 `$…$` 是普通文本（TS 的 math_inline 不跨行）",
    markdown: "$a +\nb$",
  },
  {
    id: "math-escaped-dollar-closes-early",
    mode: "byte",
    guards: "数学: `$\\$5$` 在第一个 `$` 处闭合，内容为反斜杠",
    markdown: "$\\$5$",
  },
  {
    id: "math-empty-display-is-literal",
    mode: "byte",
    guards: "数学: 空 `$$` 块退化为普通段落文本",
    markdown: "$$\n$$",
  },
  {
    id: "directive-empty-body-is-literal",
    mode: "byte",
    guards: "Directive: 空容器 `:::note\\n:::` 是普通段落文本，不是 callout",
    markdown: ":::note\n:::",
  },
  {
    id: "code-indented-eof-trailing-newline",
    mode: "byte",
    guards: "代码块: 缩进代码块在文档末尾保留源码的尾换行",
    markdown: "para\n\n    code line\n",
  },
  {
    id: "image-alt-keeps-inline-markup",
    mode: "byte",
    guards: "图片: alt 保留原始行内标记（`*示意图*` 不被剥离）",
    markdown: "![架构 *示意图*](x.png)",
  },
  {
    id: "mdx-tag-with-quoted-attribute",
    mode: "byte",
    guards: "MDX: 属性值含引号的标签不构成 HTML 块（按段落转义）",
    markdown: '<Tabs items={["a","b"]}>\n内容\n</Tabs>',
  },

  {
    id: "highlight-nested-strong",
    mode: "byte",
    guards: "highlight: `==**粗体**==` 必须以 `==` 开启（文档明确声明支持）",
    markdown: "==**粗体高亮**==",
  },
  {
    id: "highlight-nested-italic",
    mode: "byte",
    guards: "highlight: `==*斜体*==` 同样以 `==` 开启",
    markdown: "==*斜体高亮*==",
  },
  {
    id: "highlight-nested-code",
    mode: "byte",
    guards: "highlight: `==` 后紧跟行内代码",
    markdown: "==`npm i`==",
  },
  {
    id: "highlight-nested-link",
    mode: "byte",
    guards: "highlight: `==` 后紧跟链接",
    markdown: "==[文档](u)==",
  },
  {
    id: "highlight-nested-del",
    mode: "byte",
    guards: "highlight: `==` 后紧跟删除线",
    markdown: "==~~d~~==",
  },
  {
    id: "highlight-nested-math",
    mode: "byte",
    guards: "highlight: `==` 后紧跟行内数学",
    markdown: "==$b$==",
  },
  {
    id: "math-display-block-with-blank-line",
    mode: "byte",
    guards: "数学: 块级公式内部含空行仍是块级公式",
    markdown: "$$\na\n\nb\n$$",
  },
  {
    id: "math-adjacent-single-line-blocks",
    mode: "byte",
    guards: "数学: 空行分隔的两个 `$$x$$` 的怪异切分（TS 既有行为）",
    markdown: "$$a$$\n\n$$b$$\n",
  },
  {
    id: "math-quad-dollar-inline",
    mode: "byte",
    guards: "数学: 行内 `$$$$` 的怪异切分（TS 既有行为）",
    markdown: "a $$$$ b",
  },
  {
    id: "directive-inside-list-item",
    mode: "byte",
    guards: "Directive: 列表项内的 `- :::note` 识别为容器并保留 `<ul><li>` 包装",
    markdown: "- :::note\n  内容\n  :::",
  },
  {
    id: "mdx-html-block-eof-trailing-newline",
    mode: "byte",
    guards: "HTML 块: 末块且源码带尾换行时保留换行",
    markdown: "<Chart data={[1]} />\n",
  },
  {
    id: "reference-definition-eof-trailing-newline",
    mode: "byte",
    guards: "定义行: 末行且源码带尾换行时段落保留换行",
    markdown: "[foo]: /u\n",
  },
  {
    id: "mdx-self-closing-with-braces",
    mode: "byte",
    guards: "MDX: 自闭合且裸值属性构成 HTML 块（原样透传）",
    markdown: "<Chart data={[1,2,3]} />",
  },
];
