/**
 * @file alert.mjs
 * @description 渲染差分固定语料：GFM Alert / callout（`> [!TYPE]`）维度。
 *
 * 为什么需要它：callout 是目标点名要求字节级对齐的语法之一，而它的分歧几乎全部
 * 藏在「标记后缀 × 标题形态 × 正文形态 × 容器」的交界处——`]` 之后的字符
 * （`-`/`+`/空白）、大小写变体、未知类型（INFO/DANGER）、深层引用、列表项内承载。
 * 这些形态在真实文档里出现频率低、手写语料容易漏，历史分歧（`> [!NOTE]` 后跟
 * 惰性续行、`&gt;` 泄漏）都是靠枚举矩阵发现的。
 *
 * 语料来自 8 路并行探针的 L1 lane（原 `/tmp/l1-cases.mjs` + `l1b-cases.mjs` +
 * `l1c-cases.mjs` + 双标记补充），只保留用例生成部分，去掉了当时的归类代码。
 *
 * 用法：由 `scripts/render-diff/lanes/run.mjs` 汇总运行，不单独执行。
 */

/** callout 类型全集（INFO / DANGER 是 comrak 原生不支持的扩展类型）。 */
const TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "INFO", "DANGER"];

/** `]` 之后紧跟的标记形态。 */
const MARKERS = ["", "-", "+", " ", "  ", "\t"];

/** 标题形态（`]` 之后、可选的标记之后）。 */
const TITLES = [
  "",
  " Custom Title",
  " **bold title**",
  " `code title`",
  " [link](https://e.com)",
  " Title **with** `mix`",
];

/** 引用块内的正文片段（每行都已带 `> `）。 */
const BODIES = [
  ["> body text"],
  [],
  [">"],
  [">", ">"],
  ["> para one", ">", "> para two"],
  ["> - a", "> - b"],
  ["> 1. a", "> 2. b"],
  ["> ```js", "> const a = 1;", "> ```"],
  ["> | a | b |", "> | --- | --- |", "> | 1 | 2 |"],
  ["> ## inner heading"],
  ["> > nested quote"],
];

/** 构造 `> <marker>\n> <body>` 形态。 */
function quoteCase(type, marker, title, bodyLines) {
  const head = `> [!${type}]${marker}${title}`;
  return [head, ...bodyLines].join("\n");
}

/**
 * 生成 L1 全量语料（同一 markdown 只保留一次，顺序即发现顺序）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const seen = new Set();
  const cases = [];
  const add = (markdown) => {
    if (seen.has(markdown)) return;
    seen.add(markdown);
    cases.push(markdown);
  };

  // A) 7 类型 × 6 标记形态 × 基础段落正文
  for (const type of TYPES)
    for (const marker of MARKERS) add(quoteCase(type, marker, "", BODIES[0]));

  // B) 7 类型 × 6 标记形态 × 空正文（且覆盖「无换行结尾」）
  for (const type of TYPES) {
    for (const marker of MARKERS) {
      add(`> [!${type}]${marker}`);
      add(`> [!${type}]${marker}\n`);
    }
  }

  // C) 7 类型 × 6 标题形态 × 3 标记形态
  for (const type of TYPES) {
    for (const title of TITLES) {
      for (const marker of [MARKERS[0], MARKERS[1], MARKERS[4]]) {
        add(quoteCase(type, marker, title, BODIES[0]));
      }
    }
  }

  // D) 大小写变体 × 3 标记形态 × 基础正文
  for (const type of TYPES) {
    for (const variant of [type.toLowerCase(), type[0] + type.slice(1).toLowerCase()]) {
      for (const marker of [MARKERS[0], MARKERS[1], MARKERS[4]]) {
        add(quoteCase(variant, marker, "", BODIES[0]));
        add(quoteCase(variant, marker, "", []));
      }
    }
  }

  // E) 7 类型 × 正文形态（多段落/列表/代码块/表格/空白行/标题/嵌套引用）
  for (const type of TYPES) {
    for (const body of BODIES.slice(2)) {
      for (const marker of [MARKERS[0], MARKERS[4]]) add(quoteCase(type, marker, "", body));
    }
  }

  // F) 容器：嵌套引用 / 列表项内 / 有序列表内 / callout 内嵌 callout
  const CONTAINERS = [
    (type) => `> > [!${type}]\n> > body`,
    (type) => `> quote outer\n>\n> > [!${type}]\n> > body`,
    (type) => `- > [!${type}]\n  > body`,
    (type) => `1. > [!${type}]\n   > body`,
    (type) => `> [!NOTE]\n> > [!${type}]\n> > inner`,
    (type) => `> [!${type}] Outer\n> > [!TIP] Inner\n> > inner text`,
  ];
  for (const type of TYPES) {
    for (const build of CONTAINERS) {
      add(build(type));
      add(`${build(type)}\n`);
    }
  }

  // G) 引用块中夹杂普通段落
  for (const type of TYPES) {
    add(`> before paragraph\n>\n> [!${type}]\n> body`);
    add(`> [!${type}]\n> body\n>\n> after paragraph`);
    add(`> [!${type}]\n> body\n\nafter block`);
    add(`plain before\n\n> [!${type}]\n> body`);
  }

  // H) 标记前缀的书写变体
  for (const type of TYPES) {
    add(`>[!${type}]\n>body`);
    add(`>  [!${type}]\n>  body`);
    add(`>   [!${type}]\n>   body`);
    add(`> [!${type}]title\n> body`);
    add(`> [!${type}] body inline`);
    add(`> [! ${type}]\n> body`);
    add(`> [!${type} ]\n> body`);
    add(`> [!${type}][!TIP]\n> body`);
    add(`> [!${type}x]\n> body`);
    add(`> [!${type.toLowerCase()}]\n> body`);
  }

  // I) 折叠标记 + 标题 + 正文
  for (const type of TYPES) {
    add(`> [!${type}]- Title\n> body`);
    add(`> [!${type}]+ Title\n> body`);
    add(`> [!${type}]- Title\n> - a\n> - b`);
  }

  // J) 相邻两个 callout / 不同段落间隔
  for (const type of TYPES) {
    add(`> [!${type}]\n> a\n\n> [!TIP]\n> b`);
    add(`> [!${type}]\n> a\n>\n> [!TIP]\n> b`);
  }

  // K) 链接定义 / 行内代码 / 高亮出现在标题与正文
  for (const type of TYPES) {
    add(`> [!${type}] ==hl== title\n> body ==hl==`);
    add(`> [!${type}] ${type.toLowerCase()} \\*escaped\\*\n> a\\*b`);
  }

  // L) 标题里的转义 / 实体 / 特殊字符
  const TITLE_RAW = [
    " note \\*escaped\\*",
    " \\_esc\\_",
    " a\\\\b",
    " a\\`b",
    " a\\[b\\]",
    " a\\#b",
    " trailing\\",
    " &amp; amp",
    " & raw amp",
    " <tag>",
    ' "quoted"',
    " a&#42;b",
    " a&nbsp;b",
    " **bold** and *em*",
    " `code`",
    " ~~strike~~",
    " ==hl==",
    " [link](https://e.com)",
    " ![img](https://e.com/a.png)",
    " $x^2$",
    " a*b*c",
    " \\[!TIP\\]",
  ];
  for (const type of TYPES) for (const title of TITLE_RAW) add(`> [!${type}]${title}\n> body`);

  // M) 折叠标记 × 标题 × 各类型（覆盖 `-` / `+` 后跟标题）
  for (const type of TYPES) {
    add(`> [!${type}]- Title\n> body`);
    add(`> [!${type}]+ Title\n> body`);
    add(`> [!${type}]-Title\n> body`);
    add(`> [!${type}]+Title\n> body`);
    add(`> [!${type.toLowerCase()}]- Title\n> body`);
    add(`> [!${type.toLowerCase()}]+ Title\n> body`);
    add(`> [!${type.toLowerCase()}] Title\n> body`);
    add(`> [!${type}]- **bold**\n> body`);
  }

  // N) 标记与标题之间的空白字符变体
  const WS = [" ", "  ", "\t", " \t", "\t ", "   "];
  for (const type of ["NOTE", "INFO", "DANGER"]) {
    for (const ws of WS) add(`> [!${type}]${ws}\n> body`);
    for (const ws of WS) add(`> [!${type}]${ws}Title\n> body`);
    add(`> [!${type}]\u00a0Title\n> body`);
    add(`> [!${type}] Title\u00a0\n> body`);
    add(`> [!${type}]\u3000Title\n> body`);
  }

  // O) CRLF 行尾
  for (const type of TYPES) {
    add(`> [!${type}]\r\n> body\r\n`);
    add(`> [!${type}] Title\r\n> body\r\n`);
    add(`> [!${type}]\r\n> - a\r\n> - b\r\n`);
  }

  // P) 更深嵌套（3 / 4 层引用）
  for (const type of ["NOTE", "INFO", "DANGER"]) {
    add(`> > > [!${type}]\n> > > body`);
    add(`> > > > [!${type}]\n> > > > body`);
    add(`> > [!${type}]\n> > body line\n> >\n> > second`);
    add(`> outer\n> > [!${type}]\n> > body`);
  }

  // Q) INFO / DANGER 在容器中 + 丰富正文
  for (const type of ["INFO", "DANGER"]) {
    add(`- > [!${type}]\n  > - a\n  > - b`);
    add(`1. > [!${type}]\n   > body`);
    add(`> [!${type}]\n> ## h\n>\n> text`);
    add(`> [!${type}]\n> quote:\n>\n> > inner`);
    add(`> [!${type}]\n> \`\`\`js\n> const a = 1;\n> \`\`\``);
    add(`> [!${type}]\n> | a | b |\n> | --- | --- |\n> | 1 | 2 |`);
    add(`> [!${type}]\n> body\n\nafter`);
    add(`> [!${type}] T\n> body\n\n> [!${type}] U\n> body2`);
  }

  // R) 正文以引用/列表紧接标题行（无空行分隔）
  for (const type of ["NOTE", "INFO"]) {
    add(`> [!${type}]\n> - a`);
    add(`> [!${type}] T\n> - a`);
    add(`> [!${type}]\n> 1. a`);
    add(`> [!${type}]\n> \`\`\`\n> code\n> \`\`\``);
    add(`> [!${type}]\n> ---`);
    add(`> [!${type}]\n> # h`);
    add(`> [!${type}]\n> <div>html</div>`);
  }

  // S) 大小写全类型 × 折叠标记的全部组合
  for (const type of TYPES) {
    for (const variant of [type.toLowerCase(), type[0] + type.slice(1).toLowerCase()]) {
      add(`> [!${variant}]-`);
      add(`> [!${variant}]- x`);
      add(`> [!${variant}]\t`);
      add(`> [!${variant}] `);
    }
  }

  // T) 列表项 / 引用内嵌 callout 的更多组合
  for (const type of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
    add(`- item\n\n  > [!${type}]\n  > body`);
    add(`> [!${type}]\n> - > inner quote`);
    add(`> [!${type}]\n> - a\n>\n> - b`);
    add(`> [!${type}]\n> \`inline\` body`);
  }

  // U) 空正文的严格形态
  for (const type of TYPES) {
    add(`> [!${type}]\n>\n`);
    add(`> [!${type}]\n> \n`);
    add(`> [!${type}]\n>\n>\n`);
    add(`> [!${type}]`);
  }

  // V) 多行 alert 标记 `>>` / `>>>`
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    add(`>> [!${type}]\n>> body`);
    add(`>>> [!${type}]\n>>> body`);
    add(`> >> [!${type}]\n> >> body`);
  }

  // W) 惰性续行（正文行不带 `>`）
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    add(`> [!${type}] T\nlazy line`);
    add(`> [!${type}]\nlazy line`);
    add(`> [!${type}]\n> body\nlazy`);
  }

  // X) 正文首行是 setext 下划线 / 空行分隔
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    add(`> [!${type}]\n> ---`);
    add(`> [!${type}]\n> ===`);
    add(`> [!${type}]\n>\n> ---`);
    add(`> [!${type}]\n>\n> body`);
  }

  // Y) 标题中的实体 / 转义（对照 INFO/DANGER 的 raw 路径）
  const ENTITY_TITLES = [
    " &amp;",
    " a&#42;b",
    " a&nbsp;b",
    " \\*b\\*",
    " a&amp;b&amp;c",
    " &lt;x&gt;",
  ];
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    for (const title of ENTITY_TITLES) add(`> [!${type}]${title}\n> body`);
  }

  // Z) 缩进的引用块与列表项内的 alert
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    add(`  > [!${type}]\n  > body`);
    add(`- item\n  > [!${type}]\n  > body`);
    add(`- item\n\n  > [!${type}]\n\n  > body`);
    add(`> [!${type}]\n>    indented body`);
    add(`> [!${type}] T\n>\n> - a\n> - b`);
  }

  // AA) 空正文边界
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    add(`> [!${type}]\n>\n>\n>\n`);
    add(`> [!${type}] T\n`);
    add(`> [!${type}] T`);
    add(`> [!${type}]\n> \n>\n`);
  }

  // AB) alert 后紧跟同级块
  for (const type of ["NOTE", "TIP", "INFO", "DANGER"]) {
    add(`> [!${type}]\n> body\n\npara after`);
    add(`> [!${type}]\n> body\n\n> [!${type}] T2\n> body2`);
    add(`> [!${type}]\n> body\n>\n> > nested`);
    add(`# h\n\n> [!${type}]\n> body`);
  }

  // AC) 双标记 `>>` 覆盖其余类型（对应原 l1d 补充探针）
  for (const type of ["NOTE", "TIP", "WARNING", "CAUTION", "IMPORTANT"]) {
    add(`>> [!${type}]\n>> body`);
  }
  add(">>> [!NOTE]\n>>> body");
  add("> >> [!NOTE]\n> >> body");
  add(">> [!NOTE] T\n>> body");

  return cases;
}
