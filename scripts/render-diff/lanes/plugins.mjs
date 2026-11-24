/**
 * @file plugins.mjs
 * @description 渲染差分固定语料：数学公式 / `==highlight==` / `:::directive`。
 *
 * 为什么需要它：这三者都是「目标点名要求字节级对齐」的自定义语法，两侧实现
 * 完全不同（TS 用 marked 自定义扩展 + KaTeX，Rust 用 comrak + katex-rs），
 * 分歧集中在**定界符扫描规则**：`$` 连续出现的次数与位置（行内 vs 块级 vs
 * 奇数串）、KaTeX 解析失败时的错误占位、`==` 的空白与内嵌语法边界、
 * `:::` 的缩进/尾随空白/未闭合/嵌套/与段落无空行相邻。这类解析器的差异不可能
 * 靠抽样确认，必须做「定界符串长 × 容器 × 内容」的笛卡尔积枚举。
 *
 * 语料来自 8 路并行探针的 L7 lane（原 `/tmp/l7.mjs`），只保留用例生成部分。
 *
 * 用法：由 `scripts/render-diff/lanes/run.mjs` 汇总运行，不单独执行。
 */

/** 笛卡尔积（默认两段之间空一行）。 */
function product(left, right, join = "\n\n") {
  const out = [];
  for (const a of left) for (const b of right) out.push(`${a}${join}${b}`);
  return out;
}

/**
 * 生成 L7 全量语料（保持首次出现顺序，重复项由 runner 全局去重）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const collected = [];
  const add = (...markdowns) => {
    for (const markdown of markdowns) collected.push(markdown);
  };

  // ── 1. 行内数学 ────────────────────────────────────────────────
  const inline = [
    "$x$",
    "$x$ $y$",
    "$x^2$",
    "$x_1$",
    "$x_i^2$",
    "$\\frac{1}{2}$",
    "$\\sqrt{x}$",
    "$\\begin{matrix}a&b\\\\c&d\\end{matrix}$",
    "$中文$",
    "$x 中文 y$",
    "$\\alpha\\beta\\gamma$",
    "$\\sum_{i=1}^{n} i$",
    "$\\int_0^1 f(x)\\,dx$",
    "$a+b-c*d/e$",
    "$\\{x\\}$",
    "$a<b>c$",
    "$a&b$",
    "$.$",
    "$ $",
    "$   $",
    "$ x$",
    "$x $",
    "$$",
    "$$$",
    "$$$$",
    "$$$$$",
    "$x$y$z$",
    "$x$$y$$z$",
    "$a$b$c$d$",
    "a $x$ b",
    "中文$x$中文",
    "中文$x$",
    "$x$ tail",
    "head $x$",
    "$x\ny$",
    "$a\nb\nc$",
    "\\$x\\$",
    "a\\\\$b$",
    "$a\\\\b$",
    "a $$ b",
    "$x$.",
    "($x$)",
    '"$x$"',
    "**$x$**",
    "*$x$*",
    "~~$x$~~",
    "==$x$==",
    "`$x$`",
    "[$x$](https://e.com)",
    "[a $x$ b](https://e.com)",
    "![$x$](a.png)",
    "<https://e.com/$x$>",
    "$f(x) = [a]$",
    "$a = b$",
    "$a;b$",
    "$50\\%$",
    "$a\\#b$",
    "$a|b$",
    "$a\\tilde{x}b$",
    "$a_b$",
    "$a^b$",
    "$ a $",
    "const a = $x$;",
    "a$x$b",
  ];
  add(...inline);

  // 行内数学在不同容器中
  const inlineCore = ["$x$", "$\\frac{1}{2}$", "$中文$", "$ $", "$$"];
  const containers = [
    (m) => m,
    (m) => `段首。\n\n${m}\n\n段尾。`,
    (m) => `- ${m}`,
    (m) => `* ${m}`,
    (m) => `+ ${m}`,
    (m) => `- a\n  - ${m}`,
    (m) => `1. ${m}`,
    (m) => `> ${m}`,
    (m) => `> > ${m}`,
    (m) => `# ${m}`,
    (m) => `### ${m}`,
    (m) => `| a | b |\n| --- | --- |\n| ${m} | x |`,
    (m) => `<div>\n${m}\n</div>`,
    (m) => "```\n" + m + "\n```",
    (m) => '```js\nconst q = "' + m + '";\n```',
    (m) => `${m}\n\n---`,
    (m) => `---\n\n${m}`,
  ];
  for (const core of inlineCore) for (const wrap of containers) add(wrap(core));

  // ── 2. 块数学 ──────────────────────────────────────────────────
  add(
    "$$\nx\n$$",
    "$$\nx\n$$\n",
    "$$x$$",
    "$$ x $$",
    "$$\n\n$$",
    "$$\n$$",
    "$$\nx\n\ny\n$$",
    "$$\na & b\n$$",
    "$$\n中文\n$$",
    "$$\n\\frac{a}{b}\n$$",
    "$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$",
    "$$\n\\begin{cases}\n1 & x>0 \\\\\n0 & x\\le 0\n\\end{cases}\n$$",
    "$$\n\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\n$$",
    "$$\n" + "a + ".repeat(200) + "b\n$$",
    "$$\na\nb\nc\n$$",
    "$$\nx",
    "$$x",
    "$$\n",
    "\n$$\nx\n$$\n",
    "  $$\n  x\n  $$",
    "    $$\n    x\n    $$",
    "$$\na\n$$\n\ntext between\n\n$$\nb\n$$",
    "hello\n\n$$\nx\n$$",
    "$$\nx\n$$\n\nhello",
    "$$$\nx\n$$$",
    "$$\n\\(\\frac{1}{2}\\)\n$$",
    "$$\n∑_{i=1}^{n}\n$$",
    "$$\n<b>x</b>\n$$",
    "$$   \n   x   \n   $$",
    "$$\nx\n$$ ",
    "$$\r\nx\r\n$$",
    "$$\nx\ty\n$$",
  );

  const blockCore = ["$$\nx\n$$", "$$x$$", "$$\n$$\n"];
  const blockContainers = [
    (m) => m,
    (m) => `前文。\n\n${m}\n\n后文。`,
    (m) => `- ${m.replace(/\n/g, "\n  ")}`,
    (m) =>
      m
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    (m) => `# T\n\n${m}`,
    (m) => `---\n\n${m}`,
    (m) => `${m}\n\n---\n\n${m}`,
  ];
  for (const core of blockCore) for (const wrap of blockContainers) add(wrap(core));

  // ── 3. KaTeX 错误输入 ─────────────────────────────────────────
  add(
    "$\\frac{1}$",
    "$\\begin{matrix}$",
    "$\\foo$",
    "$\\notacommand{x}$",
    "$\\begin{gather}$",
    "$\\begin{matrix}x\\end{pmatrix}$",
    "$\\frac{1}{2$",
    "$a'$",
    "$\\mathbb{ABC}$",
    "$\\text{中文}$",
    "$$\n\\frac{1}\n$$",
    "$$\n\\foo\n$$",
    "$$\n\\begin{matrix}\n$$",
    "$$\n\\frac{\n$$",
    "$x$ $\\frac{1}$",
    "==$\\frac{1}$==",
  );

  // ── 4. highlight ==…== ────────────────────────────────────────
  const highlights = [
    "==x==",
    "==中文==",
    "====",
    "==",
    "===x===",
    "=====",
    "==a== ==b==",
    "a==b==c",
    "==a b==",
    "== a==",
    "==a ==",
    "== a ==",
    "==a=b==",
    "==a==b==",
    "==**a**==",
    "==*a*==",
    "==***a***==",
    "==`a`==",
    "==[a](https://e.com)==",
    "==![a](a.png)==",
    "==~~a~~==",
    "==<b>a</b>==",
    "==$x$==",
    "==$$\nx\n$$==",
    "==a\nb==",
    "==a==\n\n==b==",
    "==a",
    "== a",
    "===a==",
    "==a===",
    "== ==",
    "==a==。",
    "。==a==",
    "(==a==)",
    "**==a==**",
    "*==a==*",
    "~~==a==~~",
    "`==a==`",
    "[==a==](u)",
    "# ==a==",
    "- ==a==",
    "> ==a==",
    "| ==a== | b |\n| --- | --- |\n| c | d |",
    "中==a==",
    "==a==中",
    "中==a==中",
    "==a\tb==",
    "==\n==",
    "==123==",
    "==a<b&c>==",
    "==a\\b==",
    "==a\\==b==",
    "==hello world foo==",
    "==a== ",
    " ==a==",
    "==a== ==b== ==c==",
    "==a====b====",
    "==a==b==",
    ":::tip\n==a==\n:::",
    ":::tip ==a==\nx\n:::",
    "==a, b==",
    "==a: b==",
    "==a | b==",
    "==a-b==",
    "==a_b==",
    "==a*b==",
    '==a"b==',
    "==a'b==",
    "==😀==",
    "==" + "字".repeat(300) + "==",
    "==   ==",
    "==a\u00a0b==",
    "==a==\n==b==",
    "==**a**== 和 ==*b*==",
  ];
  add(...highlights);

  // ── 5. directive ::: ─────────────────────────────────────────
  const directiveTypes = [
    "tip",
    "note",
    "warning",
    "danger",
    "info",
    "caution",
    "important",
    "success",
    "error",
    "question",
    "example",
    "quote",
    "abstract",
    "todo",
  ];
  for (const type of directiveTypes) add(`:::${type}\n正文\n:::`);

  const directiveShapes = [
    ":::foobar\n正文\n:::",
    ":::my-custom-box\n正文\n:::",
    ":::my_box\n正文\n:::",
    ":::123\n正文\n:::",
    ":::TIP\n正文\n:::",
    ":::Tip\n正文\n:::",
    ":::tip 自定义标题\n正文\n:::",
    ":::tip 中文标题\n正文\n:::",
    ":::tip 两 个 词\n正文\n:::",
    ":::tip #tag 标题\n正文\n:::",
    ":::tip **粗体** `code`\n正文\n:::",
    ":::tip\n:::",
    ":::tip\n\n:::",
    ":::note\n\n\n:::",
    ":::tip\n正文",
    ":::tip\n正文\n\n后续段落",
    ":::tip",
    ":::",
    "::",
    "::::note\n正文\n::::",
    ":::::note\n正文\n:::::",
    ":::\n正文\n:::",
    "::: tip\n正文\n:::",
    ":::\ttip\n正文\n:::",
    ":::tip\n正文\n::: ",
    ":::tip\n正文\n::: 尾巴",
    ":::tip\n正文\n:::",
    "  :::tip\n  正文\n  :::",
    "    :::tip\n    正文\n    :::",
    "前文\n\n:::tip\n正文\n:::",
    "前文\n:::tip\n正文\n:::",
    ":::tip\n正文\n:::\n\n后文",
    ":::tip\n正文\n:::\n后文",
    ":::note\n第一段\n\n第二段\n:::",
    ":::note\n## 标题\n\n正文\n:::",
    ":::note\n- a\n- b\n:::",
    ":::note\n1. a\n2. b\n:::",
    ":::note\n```js\nconst a = 1;\n```\n:::",
    ":::note\n| a | b |\n| --- | --- |\n| 1 | 2 |\n:::",
    ":::note\n> 引用\n:::",
    ":::note\n---\n:::",
    ":::note\n---\n正文\n:::",
    ":::note\n$x$\n:::",
    ":::note\n$$\nx\n$$\n:::",
    ":::note\n==a==\n:::",
    ":::tip\n:::note\n内层\n:::\n:::",
    ":::tip 外层\n:::note 内层\nx\n:::\n:::",
    ":::tip\n:::note\n:::warning\nx\n:::\n:::\n:::",
    ":::tip\n:::note\nx\n:::\n\n:::note\ny\n:::\n:::",
    ":::note\n<div>html</div>\n:::",
    ":::note\n" + "正文很长。".repeat(100) + "\n:::",
    ":::note\n中文正文\n:::",
    ":::note\n正文   \n:::",
    ":::note\n正文\n\n:::",
    ":::note\n::: is cool\n:::",
    ":::tip\na\n:::\n\n:::note\nb\n:::",
    ":::tip\na\n::::::note\nb\n:::",
  ];
  add(...directiveShapes);

  // directive 在各容器内
  const directiveCore = [":::tip\n正文\n:::", ":::note T\n- a\n- b\n:::"];
  const directiveContexts = [
    (m) => m,
    (m) => "- " + m.replace(/\n/g, "\n  "),
    (m) => "1. " + m.replace(/\n/g, "\n   "),
    (m) =>
      m
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    (m) => `# 标题\n\n${m}`,
    (m) => `${m}\n\n# 标题`,
    (m) => `上段。\n\n${m}\n\n下段。`,
    (m) => "```md\n" + m + "\n```",
    (m) => "`" + m.replace(/\n/g, " ") + "`",
  ];
  for (const core of directiveCore) for (const wrap of directiveContexts) add(wrap(core));

  // ── 6. 组合 ──────────────────────────────────────────────────
  add(
    "==$x$==",
    "==中文$\\frac{1}{2}$中文==",
    "==\n$$\nx\n$$\n==",
    ":::tip\n==重要==\n:::",
    ":::warning ==危险==\n正文\n:::",
    ":::note\n公式 $x^2$\n:::",
    ":::note\n$$\na=b\n$$\n:::",
    ":::note\n$\\foo$\n:::",
    ":::tip\n==$x^2$==\n:::",
    ":::note\n==**重点**== $\\sum_i i$\n\n$$\n\\frac{1}{2}\n$$\n:::",
    "- ==$x$==",
    "> ==$x$== 和 $y$",
    ":::tip\n:::note\n$x$\n:::\n:::",
    ":::tip\nx\n:::\n\n$$\ny\n$$",
    "$$\ny\n$$\n\n:::tip\nx\n:::",
    "==a==\n\n:::tip\nb\n:::",
    ":::tip\nb\n:::\n\n==a==",
    "| 数学 | 高亮 |\n| --- | --- |\n| $x$ | ==a== |",
    "# $x$ ==a==",
    ":::note\n$$\\foo$$\n:::",
    "==$a$ 和 $b$==",
    "==$a=b$==",
    "==**$x$**==",
    "==:::tip==x==",
  );

  // 数学 × 目标标记的笛卡尔积（补充例数，覆盖容器 × 内容组合）
  const mathBits = ["$x$", "$\\frac{1}{2}$", "$$\nx\n$$", "==a==", "==$x$==", ":::tip\nx\n:::"];
  const delimiterBits = ["$y$", "==b==", ":::note\ny\n:::", "`$z$`", "**$w$**"];
  add(...product(mathBits, delimiterBits));
  add(...product(highlights.slice(0, 20), ["$x$", "==y==", ":::tip\nz\n:::"]));

  // ── 7. 复核轮补充形态（首轮发现的分歧族扩大取样）───────────────
  add(
    // 奇数/连写美元符
    "a $$ b",
    "a $$ bc",
    "aa $$ bb",
    "a $$ b\nc",
    "a $$$ b",
    "x $$$ y",
    "a $$$$ b",
    "a $$",
    "$$ a",
    "$$$",
    "$$$\nx\n$$$",
    "$x$$y$$z$",
    "$a$$b$",
    // 引用块/列表内的 `$$` 续行
    "> $$\n> $$",
    "> $$\n> $$\n> $$",
    "> $$\n> $$\n> ",
    "> a $$ b",
    "- $$\n  $$",
    "- $$\n $$",
    "- a $$ b",
    // highlight 内容语法边界
    "===a==",
    "===x===",
    "x===y===",
    "a===b===",
    "====x====",
    "=====x=====",
    "==a=b==",
    "==a=b=c==",
    "==$a=b$==",
    "== a==",
    "==  a==",
    "==\ta==",
    "==a== ",
    " ==a==",
    "==a==\t",
    "==a\\==b==",
    "==a\\==",
    // directive 开围栏缩进
    " :::tip\nx\n:::",
    "  :::tip\nx\n:::",
    "   :::tip\nx\n:::",
    "    :::tip\nx\n:::",
    "\t:::tip\nx\n:::",
    ":::tip\nx\n  :::",
    ":::tip\nx\n    :::",
    ":::tip\n  x\n:::",
    ":::tip\n    x\n:::",
    // directive 开围栏尾随空白
    ":::tip \nx\n:::",
    ":::tip  \nx\n:::",
    ":::tip\t\nx\n:::",
    ":::tip\nx\n::: ",
    ":::tip\nx\n:::\t",
    ":::tip\nx\n::: tail",
    ":::tip\nx   \n:::",
    // directive 前无空行（块边界要求）
    "前文\n:::tip\nx\n:::",
    "---\n:::tip\nx\n:::",
    "# T\n:::tip\nx\n:::",
    "```\na\n```\n:::tip\nx\n:::",
    "- a\n:::tip\nx\n:::",
    "- a\n\n:::tip\nx\n:::",
    "> a\n:::tip\nx\n:::",
    // directive 在有序列表 / 引用块内
    "1. :::tip\n   x\n   :::",
    "2. :::note\n   y\n   :::",
    "- :::tip\n  x\n  :::",
    "1. a\n   - :::tip\n     x\n     :::",
    "> :::tip\n> x\n> :::",
    "> :::tip\n> - a\n> - b\n> :::",
    "> > :::tip\n> > x\n> > :::",
    // 三层嵌套
    ":::tip\n:::note\n:::warning\nx\n:::\n:::\n:::",
    ":::tip\n:::note\nx\n:::\n:::",
    // codespan 内的 `:::`
    "`:::info`",
    "`:::tip 标题`",
    "x `:::info` y",
    "`:::note T - a - b :::`",
    // 通用空白（非 L7 本体，用于确认根因归属）
    "a \nb",
    "a ",
    " a",
  );

  return [...new Set(collected)];
}
