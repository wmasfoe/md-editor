/**
 * @file code.mjs
 * @description 渲染差分固定语料：代码围栏 / 缩进代码 / HTML 块 / MDX / 语言别名。
 *
 * 为什么需要它：代码块与 HTML/MDX 块是「原文透传」与「语法解析」之间最容易
 * 打滑的一族。差异集中在——围栏字符与长度、info string 的解析（含属性、大写、
 * 未知语言）、未闭合围栏到 EOF 的边界、缩进代码块的缩进度与尾随换行、HTML 块
 * 对前后块的打断语义（哪些标签能中断段落）、MDX 表达式与自闭合组件、以及
 * `:::directive` / 引用块 / 列表内承载代码块。这些都是组合爆炸点，只能枚举。
 *
 * 语料来自 8 路并行探针的 L4 lane（原 `/tmp/l4.mjs`），只保留用例生成部分。
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
 * 生成 L4 全量语料（去重，保持首次出现顺序）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const collected = [];
  const add = (markdown) => collected.push(markdown);

  // ═════════════════════════════════════════════════════════════
  // 1. 围栏：字符 × 长度 × info string
  // ═════════════════════════════════════════════════════════════
  const FENCE_CHARS = ["`", "~"];
  const FENCE_LENS = [3, 4, 5];
  const INFOS = ["", " ", "js", "js foo", "js {1,2}", 'js title="x"', "JS", "zzz", "text", "plain"];
  for (const char of FENCE_CHARS) {
    for (const len of FENCE_LENS) {
      for (const info of INFOS) {
        add(`${char.repeat(len)}${info}\nconst a = 1;\n${char.repeat(len)}\n`);
      }
    }
  }

  // info string 变体：制表符分隔、尾随空格、纯符号
  const INFO_VARIANTS = ["js\tfoo", "js  ", " js", "\tjs", "{1,2}", "js;foo", "c++", "c#"];
  for (const info of INFO_VARIANTS) {
    add(`\`\`\`${info}\nconst a = 1;\n\`\`\`\n`);
    add(`~~~${info}\nconst a = 1;\n~~~\n`);
  }

  // 代码内容 × info
  const TRICKY_BODIES = [
    "<div>hi</div>",
    "a & b",
    "a < b > c",
    "`` nested backticks ``",
    "$$ x $$",
    "中文注释 // CJK",
    "-->",
    "</script>",
    "  leading spaces",
    "trailing spaces   ",
    "\ttab line",
    "   ",
  ];
  for (const info of INFOS) {
    for (const body of TRICKY_BODIES) add(`\`\`\`${info}\n${body}\n\`\`\`\n`);
  }

  // 空代码块
  for (const char of FENCE_CHARS) {
    for (const len of FENCE_LENS) {
      add(`${char.repeat(len)}\n${char.repeat(len)}\n`);
      add(`${char.repeat(len)}\n\n${char.repeat(len)}\n`);
      add(`${char.repeat(len)}js\n${char.repeat(len)}\n`);
    }
  }

  // 闭合围栏变异
  const CLOSERS = [
    "```",
    "````",
    "``",
    "``` ",
    "``` js",
    " ```",
    "  ```",
    "   ```",
    "    ```",
    "\t```",
    "`````",
  ];
  for (const closer of CLOSERS) {
    add(`\`\`\`js\nconst a = 1;\n${closer}\n`);
    add(`~~~~\ncode\n${closer}\n`);
  }
  // 开启围栏缩进 0-4 / tab
  for (const indent of ["", " ", "  ", "   ", "    ", "\t", " \t", "  \t"]) {
    add(`${indent}\u0060\u0060\u0060js\nconst a = 1;\n\u0060\u0060\u0060\n`);
    add(`${indent}~~~\ncode\n~~~\n`);
    add(`${indent}~~~js\ncode\n~~~\n`);
  }

  // ═════════════════════════════════════════════════════════════
  // 2. 未闭合围栏（到 EOF）
  // ═════════════════════════════════════════════════════════════
  const UNCLOSED = [
    "```\nunclosed",
    "```\nunclosed\n",
    "```js\nunclosed\n\n",
    "~~~\nunclosed",
    "~~~~\nunclosed\nmore\n",
    "text\n\n```js\nconst a = 1;\n",
    "```js\nline1\nline2\n\nline4\n",
    "```\n```inner\n",
    "> ```\n> quoted unclosed\n",
    "- ```\n  list unclosed\n",
    "```js\n\n\n",
    "````\n```\n````\n",
    "```\n<!-- comment -->\n",
    "```\n</div>\n",
    "```\n# heading\n\nparagraph\n",
    "```js\n```js\n",
    "~~~js\na\n~~~",
    "```js\n a\n```",
  ];
  for (const markdown of UNCLOSED) add(markdown);

  // ═════════════════════════════════════════════════════════════
  // 3. 缩进代码块：缩进度 / tab / 混用 / 空行 / 围栏字符 / 列表内
  // ═════════════════════════════════════════════════════════════
  const INDENT_PREFIXES = [
    " ",
    "  ",
    "   ",
    "    ",
    "     ",
    "\t",
    " \t",
    "  \t",
    "   \t",
    "\t ",
    "\t\t",
    "    \t",
  ];
  for (const indent of INDENT_PREFIXES) {
    add(`${indent}code line\n`);
    add(`${indent}const a = 1;\n`);
    add(`para\n\n${indent}code line\n`);
    add(`${indent}<div>x</div>\n`);
    add(`${indent}\u0060\u0060\u0060js\n`);
    add(`${indent}~~~\n`);
    add(`${indent}a & b < c\n`);
    add(`${indent}中文\n`);
  }

  // 缩进代码块 + 后续形态（尾换行规则）
  const INDENT_BODIES = [
    "    code line\n",
    "    code line",
    "    code line\n\n",
    "    code line\n\n\n",
    "    code line\nx\n",
    "    code line\n\nx\n",
    "    code line\nx",
    "    a\n\n    b\n",
    "    a\n\n    b\n\n",
    "    a\n\n    b\nx\n",
    "    a\n    b\n\n",
    "    a\n    b\nx\n",
    "    <!-- html comment -->\n",
    "    <!-- html comment -->\n\n",
    "    ```\n    inner\n    ```\n",
    "    ```\n    inner\n    ```\n\n",
    "    ```js\nx\n```\n",
    "    \u0060\u0060\u0060js\nfoo\n",
    "    ~~~\nbar\n~~~\n",
    "    <div>\n",
    "    <div>\n\n",
    "para\n\n    code\n",
    "para\n\n    code\n\n",
    "para\n\n    code\n\nafter\n",
    "    code\n# h\n",
    "    code\n\n# h\n",
    "    code\n---\n",
    "    code\n- item\n",
    "    code\n> quote\n",
    "\tcode\nx\n",
    "\tcode\n\n",
  ];
  for (const markdown of INDENT_BODIES) add(markdown);

  // 列表 / 引用内的缩进代码
  const LIST_INDENT = [
    "- item\n\n      code in list\n",
    "- item\n\n  \u0060\u0060\u0060js\n  const a = 1;\n  \u0060\u0060\u0060\n",
    "- item\n\n        eight spaces code\n",
    "1. item\n\n       code\n",
    "- item\n  continuation\n\n      code\n",
    "> quote\n>\n>     indented code\n",
    "- a\n- b\n\n      code\n",
    "- \n      code\n",
    "- item\n\n      <div>x</div>\n",
    "- item\n\n      \u0060\u0060\u0060\n      inner\n      \u0060\u0060\u0060\n",
    "  - nested\n\n        code\n",
    "- item\n\n\t\tcode with tabs\n",
    "- item\n\n      code\n\n      more\n",
    "- item\n\n      code\n- next\n",
  ];
  for (const markdown of LIST_INDENT) add(markdown);

  // ═════════════════════════════════════════════════════════════
  // 4. HTML 块
  // ═════════════════════════════════════════════════════════════
  const HTML_BLOCKS = [
    "<div>\nx\n</div>\n",
    '<div class="x">\nx\n</div>\n',
    '<div class="x" id="y" data-z="1">\nx\n</div>\n',
    "<div>x</div>\n",
    "<p>x</p>\n",
    "<p>\nx\n</p>\n",
    "<table>\n<tr><td>1</td></tr>\n</table>\n",
    "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>\n",
    "<script>\nconsole.log(1);\n</script>\n",
    '<script type="module">\nimport x from "y";\n</script>\n',
    "<style>\n.a { color: red; }\n</style>\n",
    "<pre>\n  raw   text\n</pre>\n",
    "<pre><code>x &amp; y</code></pre>\n",
    "<!-- comment -->\n",
    "<!-- multi\nline\ncomment -->\n",
    "<!--comment-->\n",
    "<!-- \n\nblank line inside\n\n -->\n",
    "<br/>\n",
    "<br />\n",
    "<hr/>\n",
    "<foo>\nx\n</foo>\n",
    '<foo bar="1">\nx\n</foo>\n',
    "<unknown-tag attr>\nx\n</unknown-tag>\n",
    "<span>x</span>\n",
    "<div>\n",
    "</div>\n",
    "<div>\n\nmarkdown *inside*\n\n</div>\n",
    "text before\n<div>\nx\n</div>\n",
    "<div>\nx\n</div>\ntext after\n",
    "para\n\n<div>\nx\n</div>\n\npara\n",
    "# Heading\n\n<div>x</div>\n\n## Another\n",
    "  <div>\n  indented two\n  </div>\n",
    "    <div>\n    indented four\n    </div>\n",
    "\t<div>\ttab</div>\n",
    "<div>\n```js\ncode inside div\n```\n</div>\n",
    "<div>\n| a | b |\n|---|---|\n| 1 | 2 |\n</div>\n",
    "<div>\n- list in div\n- item\n</div>\n",
    "<div>&amp; &lt; &gt; &quot; &#39;</div>\n",
    "<div>raw & unescaped</div>\n",
    "<div>中文内容</div>\n",
    "<DIV>\nuppercase\n</DIV>\n",
    '<Div Class="x">\n</Div>\n',
    '<div\n  class="multi"\n  id="line"\n>\nx\n</div>\n',
    "<details>\n<summary>s</summary>\n\nbody\n\n</details>\n",
    '<iframe src="x"></iframe>\n',
    '<video controls><source src="a.mp4"></video>\n',
    '<svg><circle r="1"/></svg>\n',
    "<math><mi>x</mi></math>\n",
    '<form action="/"><input type="text"></form>\n',
    "<template><div>x</div></template>\n",
    "<p>a</p><p>b</p>\n",
    "<div><div><div>deep</div></div></div>\n",
    "<x-y>custom element</x-y>\n",
    "<div data-x='single'>\n</div>\n",
    "<textarea>\n  raw  \n</textarea>\n",
    "<![CDATA[x]]>\n",
    "<!doctype html>\n",
    "<div>\n</div>\n<div>\n</div>\n",
    '<a href="#">link</a>\n',
    '<img src="a.png" alt="a">\n',
    "<ul>\n<li>a</li>\n</ul>\n",
    "<h1>raw heading</h1>\n",
    "<blockquote>q</blockquote>\n",
    '<div style="color:red">styled</div>\n',
    "<div>\n\n</div>\n",
    "<div>\n</span>\n</div>\n",
    "<div>&#x4e2d;</div>\n",
    "<div>a<br>b</div>\n",
    "<div>\nlast line no newline</div>\n",
    "<div>x</div>",
    "<!-- c -->",
    "<foo>\nx\n</foo>",
  ];
  for (const markdown of HTML_BLOCKS) add(markdown);

  // HTML 块成对相邻
  for (const pair of product(
    ["<div>\na\n</div>", "<p>a</p>", "<!-- c -->"],
    ["<div>\nb\n</div>", "<p>b</p>"],
  )) {
    add(`${pair}\n`);
  }

  // HTML 块紧跟段落（无空行）——段落打断语义
  const INTERRUPT_TAGS = [
    "<b/>",
    "<br/>",
    "<Component />",
    "<foo>",
    "<x>",
    "<custom-el>",
    "<span>x</span>",
    "<div>x</div>",
    "<section>x</section>",
    "<!-- c -->",
    "<pre>x</pre>",
    "<script>x</script>",
    '<img src="a">',
  ];
  for (const tag of INTERRUPT_TAGS) {
    add(`text\n${tag}\n`);
    add(`text\n${tag}\nmore\n`);
    add(`text *em*\n${tag}\n`);
    add(`text\n${tag}\n\nmore\n`);
    add(`text\n${tag}\n# h\n`);
    add(`> text\n> ${tag}\n`);
    add(`- text\n  ${tag}\n`);
    add(`${tag}\ntext\n`);
  }

  // HTML 块 + 后续块（含空行 / 无空行）
  const HTML_HEADS = [
    "<div>x</div>",
    "<!-- c -->",
    "<b/>",
    "<Component />",
    "<foo>\ny\n</foo>",
    "<br/>",
  ];
  const HTML_TAILS = [
    "# h",
    "para",
    "- item",
    "```js\nx\n```",
    ":::note\nx\n:::",
    "---",
    "    code",
    "> q",
  ];
  for (const head of HTML_HEADS) {
    for (const tail of HTML_TAILS) {
      add(`${head}\n${tail}\n`);
      add(`${head}\n\n${tail}\n`);
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 5. MDX
  // ═════════════════════════════════════════════════════════════
  const MDX = [
    "<Component />\n",
    "<Component/>\n",
    "<Component />\n\ntext\n",
    "<Component>\nchild\n</Component>\n",
    "<C a={1}>x</C>\n",
    "<C a={1} />\n",
    '<C\n  a="b"\n/>\n',
    '<C\n  a="b"\n  c={2}\n/>\n',
    "{expr}\n",
    "{ expression }\n",
    "{a + b}\n",
    "{/* mdx comment */}\n",
    "text {expr} text\n",
    "## {title}\n",
    "<Component {...props} />\n",
    'import X from "y";\n\n<X />\n',
    "export const meta = { a: 1 };\n",
    "<A.B />\n",
    "<A:B />\n",
    "<C>{children}</C>\n",
    "<C>\n\n{body}\n\n</C>\n",
    "> <C />\n",
    "- <C />\n",
    "```jsx\n<C a={1} />\n```\n",
    "`{expr}`\n",
    "<C>{`code`}</C>\n",
    "{\n  multiline\n}\n",
    "<C a={{b: 1}} />\n",
    "<C a='q' />\n",
    "<C disabled />\n",
    "<C onClick={() => go()} />\n",
    "<C\n></C>\n",
    "<>\nfragment\n</>\n",
    "<C a={1}>\n\n<div>raw</div>\n\n</C>\n",
    "{{ braces }}\n",
    '{"string"}\n',
    "{/*\nmultiline\n*/}\n",
    "<C />\n\n<D />\n",
    "text <C /> text\n",
    "<C>&amp;</C>\n",
    '<C\n  a="b"\n  c={2}\n>\n  child\n</C>\n',
    "para\n<Component />\n",
    "para\n\n<Component />\n",
    "<Component />\npara\n",
  ];
  for (const markdown of MDX) add(markdown);

  // ═════════════════════════════════════════════════════════════
  // 6. 语言别名覆盖
  // ═════════════════════════════════════════════════════════════
  const LANGUAGE_SNIPPETS = {
    ts: "const x: number = 1;",
    tsx: "const C = () => <div>hi</div>;",
    jsx: 'const C = () => <div className="x">hi</div>;',
    js: "function f(a) {\n  return a + 1;\n}",
    javascript: "let s = `t${1}`;",
    node: "const fs = require('fs');",
    json: '{"a": 1, "b": [true, null]}',
    bash: 'echo "hi"\nls -la',
    sh: "#!/bin/sh\nset -e\ncat a | wc -l",
    diff: "- a\n+ b\n  c",
    py: "def f(x):\n    return x + 1",
    python: "class A:\n    pass",
    rs: 'fn main() {\n    println!("hi");\n}',
    rust: "let mut v: Vec<u8> = vec![];",
    go: 'func main() {\n\tfmt.Println("hi")\n}',
    yaml: "a: 1\nb:\n  - x\n  - y",
    yml: "key: value",
    css: ".a { color: red; }",
    html: '<div class="x">hi</div>',
    md: "# Title\n\n**bold** and `code`",
    markdown: "> quote",
    sql: "SELECT * FROM t WHERE a = 1;",
    java: "public class A {\n  int x = 1;\n}",
    c: "int main(void) {\n  return 0;\n}",
    cpp: "#include <iostream>\nint main() { return 0; }",
    "c++": "std::vector<int> v;",
    rb: "def f\n  1\nend",
    ruby: "puts :sym",
    php: "<?php\n echo 1;\n?>",
    swift: "let x = 1\nprint(x)",
    kotlin: 'fun main() {\n  println("hi")\n}',
    kt: "val x = 1",
    tex: "\\frac{a}{b}",
    latex: "x^2",
    toml: "a = 1\n[b]\nc = 2",
    graphql: "query { a }",
    gql: "mutation { b }",
    cs: "var a = 1;",
    csharp: "public void M() {}",
    text: "plain text",
    plain: "plain text",
    zzz: "unknown lang body",
    "": "no language body",
  };
  for (const [alias, snippet] of Object.entries(LANGUAGE_SNIPPETS)) {
    add(`\u0060\u0060\u0060${alias}\n${snippet}\n\u0060\u0060\u0060\n`);
    add(`\u0060\u0060\u0060${alias.toUpperCase()}\n${snippet}\n\u0060\u0060\u0060\n`);
    add(`\u0060\u0060\u0060${alias} extra\n${snippet}\n\u0060\u0060\u0060\n`);
    add(`~~~${alias}\n${snippet}\n~~~\n`);
  }

  // 语言 × 代码内容交叉
  const CROSS_LANGS = ["js", "ts", "html", "css", "json", "zzz", ""];
  const CROSS_BODIES = ["<div>x</div>", "a & b < c", "中文", "`backtick`", "$$", "", "  "];
  for (const lang of CROSS_LANGS) {
    for (const body of CROSS_BODIES) {
      add(`\u0060\u0060\u0060${lang}\n${body}\n\u0060\u0060\u0060\n`);
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 7. 上下文组合
  // ═════════════════════════════════════════════════════════════
  const BLOCK_UNITS = [
    "\u0060\u0060\u0060js\nconst a = 1;\n\u0060\u0060\u0060",
    "    indented code",
    "<div>x</div>",
    "<!-- c -->",
    "# H1",
    "para",
    "---",
    "> quote",
    "- item",
    "| a | b |\n|---|---|\n| 1 | 2 |",
  ];
  for (const adjacent of product(BLOCK_UNITS, BLOCK_UNITS)) add(`${adjacent}\n`);

  // 围栏内嵌围栏
  add("````md\n```js\nconst a = 1;\n```\n````\n");
  add("`````\n````\n```\n``\n`````\n");
  add("~~~md\n```js\nx\n```\n~~~\n");
  add("~~~~\n~~~\ninner\n~~~\n~~~~\n");

  // 容器的承载（callout / blockquote / list）
  const CONTAINED = [
    "> :::note\n> ```js\n> const a = 1;\n> ```\n> :::\n",
    ":::note\n```js\nconst a = 1;\n```\n:::\n",
    ":::tip\n<div>x</div>\n:::\n",
    ":::note\n<Component />\n:::\n",
    ":::note\n<b/>\n:::\n",
    ":::note\n<br/>\n:::\n",
    ":::note\n<foo>\nx\n</foo>\n:::\n",
    ":::note\n<Component>x</Component>\n:::\n",
    ":::note\n<div/>\n:::\n",
    ":::note\n<Component />\n\ntext\n:::\n",
    ":::note\ntext\n\n<Component />\n:::\n",
    "> :::note\n> text\n> :::\n",
    "> :::note\n> <Component />\n> :::\n",
    "- :::note\n  text\n  :::\n",
    "- ```js\n  const a = 1;\n  ```\n",
    "1. step\n\n   ```bash\n   ls\n   ```\n",
    "> <div>\n> x\n> </div>\n",
    "> <C />\n",
    "> <div>x</div>\n",
    "> <!-- c -->\n",
    "> <div>x</div>\n\npara\n",
    "> para\n>\n> <div>x</div>\n",
    "> > <div>x</div>\n",
    "> <div>\nx\n</div>\n",
    "> <div>x</div>\n> <!-- c -->\n",
    "> <b/>\n",
    "> <foo>\ny\n</foo>\n",
  ];
  for (const markdown of CONTAINED) add(markdown);

  // EOL / EOF 变异
  for (const eol of ["\r\n", "\n"]) {
    add(`\u0060\u0060\u0060js${eol}const a = 1;${eol}\u0060\u0060\u0060${eol}`);
    add(`<div>${eol}x${eol}</div>${eol}`);
    add(`    code${eol}`);
    add(`<Component />${eol}`);
  }
  for (const tail of ["", "\n", "\n\n", " \n", "\n\n\n"]) {
    add(`\u0060\u0060\u0060js\ncode\n\u0060\u0060\u0060${tail}`);
    add(`<div>x</div>${tail}`);
    add(`    code\n${tail}`);
    add(`<b/>${tail}`);
  }

  return [...new Set(collected)];
}
