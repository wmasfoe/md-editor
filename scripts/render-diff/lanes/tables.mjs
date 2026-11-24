/**
 * @file tables.mjs
 * @description 渲染差分固定语料：GFM 表格 / 分割线 / frontmatter。
 *
 * 为什么需要它：表格与分割线的分歧不在「正常写法」，而在**退化形态**——
 * 分隔行与表头列数不齐、分隔行只写 `-`、单元格里含未转义 `|` 或行内代码、
 * 空单元格与空白单元格、表格紧邻段落/围栏/HTML 块（能否被打断）、
 * `---` 同时是 setext 下划线与分割线与 frontmatter 定界符的三义性、
 * BOM 前缀与连续 `---` 对 frontmatter 正则的影响。这些只能按维度枚举。
 *
 * 语料来自 8 路并行探针的 L5 lane（原 `/tmp/l5-corpus.mjs`），只保留用例生成部分。
 *
 * 用法：由 `scripts/render-diff/lanes/run.mjs` 汇总运行，不单独执行。
 */

/** 生成 GFM 表格（带外框竖线）。 */
function table(headers, aligns, rows) {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${aligns.join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** 生成不带外框竖线的表格。 */
function tableNoOuter(headers, aligns, rows) {
  const lines = [headers.join(" | "), aligns.join(" | "), ...rows.map((row) => row.join(" | "))];
  return lines.join("\n");
}

/**
 * 生成 L5 全量语料（去重，保持首次出现顺序）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const cases = [];
  const add = (...markdowns) => {
    for (const markdown of markdowns) {
      if (typeof markdown === "string" && markdown.length) cases.push(markdown);
    }
  };

  // ---------------------------------------------------------------- 1. 对齐矩阵
  const ALIGNS = [":---", "---:", ":---:", "---", ":-", "-:", "-", "::", "---:  "];
  const HEADS = ["a", "b", "c", "d"];

  for (const align of ALIGNS) {
    for (const cols of [1, 2, 3]) {
      const headers = HEADS.slice(0, cols);
      const full = Array.from({ length: cols }, () => align);
      const variants = [full];
      if (cols > 1) variants.push(full.slice(0, cols - 1)); // 分隔行少一列
      variants.push([...full, align]); // 分隔行多一列
      if (cols > 1) variants.push([full[1], full[0], ...full.slice(2)]); // 混合顺序
      for (const aligns of variants) {
        add(table(headers, aligns, []));
        add(table(headers, aligns, [headers.map((h) => `${h}1`)]));
        add(tableNoOuter(headers, aligns, [headers.map((h) => `${h}1`)]));
      }
    }
  }

  // 显式混合对齐
  for (const aligns of [
    [":---", "---:"],
    ["---", ":---:"],
    [":---:", "---", ":---"],
    [":---", "---:", ":---:", "---"],
  ]) {
    const headers = HEADS.slice(0, aligns.length);
    add(table(headers, aligns, []));
    add(table(headers, aligns, [headers.map((h) => `${h}x`)]));
    add(table(headers, aligns, [headers.map((h) => `${h}1`), headers.map((h) => `${h}2`)]));
    add(tableNoOuter(headers, aligns, [headers.map((h) => `${h}x`)]));
  }

  // ------------------------------------------------------------ 2. 单元格内容
  const CELL_CONTENTS = [
    "`a|b`",
    "`a\\|b`",
    "a\\|b",
    "",
    "   ",
    "**bold**",
    "*em*",
    "***boldem***",
    "[link](https://example.com)",
    "![img](pic.png)",
    "$x^2$",
    "$$y$$",
    "~~del~~",
    "==hl==",
    "中文内容",
    "混合 CJK 与 ascii",
    "a".repeat(220),
    "`code` 与 **b**",
    "\\|",
    "<b>x</b>",
    "snake_case_word",
    "a - b",
    "100%",
    "[ref][1]\n\n[1]: https://example.com",
    "`<div>`",
    "x<br>y",
    "a  b",
    "  leading space",
    "trailing space  ",
    "@mention #tag",
  ];
  for (const cell of CELL_CONTENTS) {
    // 1 列表格
    add(table(["h"], ["---"], [[cell]]));
    add(table(["h"], [":---:"], [[cell]]));
    // 3 列表格中间一格
    add(table(["h1", "h2", "h3"], ["---", ":---", "---:"], [["1", cell, "3"]]));
    // 表头含该内容
    add(table([cell, "b"], ["---", "---"], [["1", "2"]]));
  }

  // 空单元格矩阵（原探针在这里有个 `table(headers, aligns, [], [row])` 调用，但
  // `table` 只取 3 个参数，第二行参数被签名丢弃后与上一行同值，故不再重复生成）
  for (const cols of [2, 3]) {
    const headers = HEADS.slice(0, cols);
    const aligns = Array.from({ length: cols }, () => "---");
    const emptyRow = Array.from({ length: cols }, () => "");
    add(table(headers, aligns, [emptyRow]));
    for (let i = 0; i < cols; i += 1) {
      const row = Array.from({ length: cols }, () => "x");
      row[i] = "";
      add(table(headers, aligns, [row]));
    }
    // 行内多余空格
    const spacedRow = Array.from({ length: cols }, () => "x").join("  |  ");
    add(`| ${headers.join("  |  ")} |\n|${aligns.join("|")}|\n|${spacedRow}|`);
  }

  // ---------------------------------------------------------------- 3. 行数/列数
  const H2 = ["a", "b"];
  for (const rows of [
    [],
    [["1", "2"]],
    [
      ["1", "2"],
      ["3", "4"],
    ],
    [
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ],
  ]) {
    add(table(H2, ["---", "---"], rows));
    add(table(H2, [":---", "---:"], rows));
    add(tableNoOuter(H2, ["---", "---"], rows));
  }
  // 只有 1 列表头
  add(table(["only"], ["---"], [["v"]]));
  add("only\n---\nv");
  add("| only |\n| --- |\n| v |\n| v2 |");
  // 列数不齐的数据行
  add("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |");
  add("| a | b |\n| --- | --- |\n| 1 | 2 | 3 |");
  add("| a | b |\n| --- | --- |\n| 1 |");
  add("| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |");
  add("| a | b |\n| --- | --- | --- |\n| 1 | 2 |");
  // 表头后无分隔行
  add("| a | b |\n| 1 | 2 |");
  add("a | b\n1 | 2");
  // 单行单元格内转义
  add("| a\\|b |\n| --- |\n| c\\|d |");
  // 含行内代码的反引号数量变化
  add("| `a` | b |\n| --- | --- |\n| ``x|y`` | z |");
  add("| a | b |\n| --- | --- |\n| ``x|y`` | z |");

  // ------------------------------------------------------------ 4. 前后紧邻上下文
  const CORE_TABLES = [
    table(["a", "b"], ["---", "---"], [["1", "2"]]),
    table(["a", "b"], [":---", "---:"], []),
    tableNoOuter(["a", "b"], ["---", "---"], [["1", "2"]]),
  ];
  const PREFIXES = ["", "para\n\n", "para\n", "# h\n\n", "> quote\n\n"];
  const SUFFIXES = ["", "\n\npara", "\npara", "\n\n# h", "\n\n> quote"];
  for (const core of CORE_TABLES) {
    for (const pre of PREFIXES) {
      for (const suf of SUFFIXES) add(`${pre}${core}${suf}`);
    }
  }

  // 列表内表格
  const LIST_CTX = [
    (t) => `- ${t.split("\n").join("\n  ")}`,
    (t) => `- item\n- ${t.split("\n").join("\n  ")}`,
    (t) => `1. step\n\n   ${t.split("\n").join("\n   ")}`,
    (t) => `- item\n\n  ${t.split("\n").join("\n  ")}\n\n- after`,
    (t) => `- item\n\n${t}`,
    (t) => `- a\n  - ${t.split("\n").join("\n    ")}`,
  ];
  // 引用块内表格
  const QUOTE_CTX = [
    (t) => `> ${t.split("\n").join("\n> ")}`,
    (t) => `> quote\n>\n> ${t.split("\n").join("\n> ")}`,
    (t) => `> ${t.split("\n").join("\n> ")}\n>\n> after`,
  ];
  // callout 内表格
  const CALLOUT_CTX = [
    (t) => `:::tip\n${t}\n:::`,
    (t) => `:::note Title\n${t}\n:::`,
    (t) => `:::tip\nintro\n\n${t}\n:::`,
  ];

  for (const core of CORE_TABLES) {
    for (const wrap of [...LIST_CTX, ...QUOTE_CTX, ...CALLOUT_CTX]) add(wrap(core));
  }

  // 表格紧邻其它块
  for (const core of CORE_TABLES) {
    add(`${core}\n---`);
    add(`---\n${core}`);
    add(`${core}\n---\n`);
    add(`${core}\n\n---\n\n${core}`);
    add(`\`\`\`\ncode\n\`\`\`\n${core}`);
    add(`${core}\n\`\`\`\ncode\n\`\`\``);
    add(`<div>x</div>\n${core}`);
    add(`${core}\n<div>x</div>`);
  }

  // ------------------------------------------------------------- 5. 分割线
  const HR_STYLES = [
    "---",
    "***",
    "___",
    "- - -",
    "* * *",
    "_ _ _",
    "*** ***",
    "-----",
    "-- -",
    "  ---",
    "---  ",
    "----",
    "****",
    "____",
  ];
  const HR_CTX = [
    (h) => h,
    (h) => `text\n\n${h}`,
    (h) => `${h}\n\ntext`,
    (h) => `text\n\n${h}\n\ntext`,
    (h) => `# h\n\n${h}`,
    (h) => `${h}\n\n# h`,
    (h) => `para line\n${h}\n\nafter`,
    (h) => `> ${h}`,
    (h) => `> quote\n>\n> ${h}`,
    (h) => `- item\n\n  ${h}`,
    (h) => `:::tip\n${h}\n:::`,
    (h) => `${h}\n${h}`,
    (h) => `${h}\n\n${h}`,
    (h) => `**bold**\n\n${h}`,
    (h) => `${h}\n\n**bold**`,
    (h) => `| a |\n| --- |\n| 1 |\n\n${h}`,
    (h) => `${h}\n\n| a |\n| --- |\n| 1 |`,
    (h) => `${h}\ntext`,
    (h) => `text\n${h}\ntext`,
  ];
  for (const h of HR_STYLES) for (const wrap of HR_CTX) add(wrap(h));

  // setext 歧义
  const SETEXT = [
    "text\n---",
    "text\n===",
    "text\n---\n",
    "text\n---\ntext",
    "text\n===\ntext",
    "\ntext\n---",
    "text\n\n---",
    "text\n\n===",
    "text\n --",
    "text\n--",
    "text\n- - -",
    "text\n===",
    "text\n=====",
    "title\n---\nsubtitle",
    "para one\n\npara two\n---",
    "- item\n---",
    "1. item\n---",
    "> quote\n---",
    "text with `code`\n---",
    "**b**\n---",
    "line one\nline two\n---",
    "a\n\nb\n---\nc",
    "text\n***",
    "text\n___",
    "text\n===\n---",
    "text\n---\n===",
    "# h\n---",
    "text\n---  ",
    "text   \n---",
  ];
  for (const setext of SETEXT) add(setext);

  // ------------------------------------------------------------ 6. frontmatter
  const FRONTMATTER = [
    "---\nkey: value\n---",
    "---\nkey: value\n---\n",
    "---\nkey: value\n---\nbody",
    "---\nkey: value\n---\n\nbody",
    "---\nkey: value\n---\n\n# Heading\n\ntext",
    "---\ntitle: T\n---",
    "---\ntitle: T\n---\n",
    "---\n---",
    "---\n---\n",
    "---\n---\nbody",
    "---\n---\n\nbody",
    "---\n",
    "---",
    "---\nkey: value",
    "---\nkey: value\n--",
    "---\nkey: value\n----",
    "---\ntitle: a\n---\nnested\n---\nkey: b\n---\n",
    "---\nkey: value\n---\n---\n---\n",
    "---\na: |\n  ---\n  b\n---\nbody",
    "---\nkey: value\n---\r\nbody",
    "---\r\nkey: value\r\n---\r\nbody",
    "+++\nkey: value\n+++\nbody",
    "+++\ntitle: T\n+++\n",
    '---\ntitle: "quoted --- inside"\n---\nbody',
    "---\ntags: [a, b]\n---\n",
    "---\nkey: value\n---\n| a |\n| --- |\n| 1 |",
    "---\nkey: value\n---\n---\n",
    " ---\nkey: value\n---\n",
    "---\nkey: value\n ---\nbody",
    "---\nkey: value\n--- ",
    "---\nkey: value\n---\n   ",
    "\n---\nkey: value\n---\nbody",
    "text\n---\nkey: value\n---\n",
    "---\nkey: value\n\nkey2: v2\n---\nbody",
    "---\nkey\n---\n",
    "---\nkey: value\n---\n> quote",
    "---\nkey: value\n---\n:::tip\nx\n:::",
    "---\nkey: value\n---\n- list",
    "---\nkey: value\n---\n```js\nx\n```",
    "---\ntitle: 中文\n---\nbody",
    "---\n\n---\nbody",
    "---\n \n---\nbody",
    "---\nkey: value\n---\n\n---\n\nother",
    "\ufeff---\nkey: value\n---\nbody",
    "---\nkey: value\n---\n---\nkey: b\n---\n",
  ];
  for (const frontmatter of FRONTMATTER) add(frontmatter);

  // 伪 frontmatter + 表格/分割线交叉
  for (const frontmatter of ["---\nkey: v\n---", "---\n---"]) {
    for (const core of CORE_TABLES.slice(0, 1)) {
      add(`${frontmatter}\n\n${core}`);
      add(`${frontmatter}\n${core}`);
    }
    add(`${frontmatter}\n\n---\n\ntext`);
  }

  // ---------------------------------------------- 7. 紧凑语法 / 退化分隔行
  add(
    "|a|b|\n|-|-|\n|1|2|",
    "|a|b|\n|:-:|:-:|\n|1|2|",
    "|a|b|\n|:-|-:|\n|1|2|",
    "|a|\n|-|\n|1|",
    "|a|\n|-:|\n|1|",
    "|a|b|\n|---|---|\n|1|",
    "|a|b|\n|---|---|\n|1|2|3|",
    "a|b\n--:|:--\n1|2",
    "a|b\n:-:|:-:\n1|2",
    "|a|b|\n| |\n|1|2|",
    "|a|b|\n|\n|1|2|",
    "|a|b|\n|---|--\n|1|2|",
    "|a|b|\n| :--- | ---: |\n|1|2|",
    "| a | b |\n|:---:|:---:|\n| 1 | 2 |",
    "|a|b|c|\n|:-|:-:|-:|\n|1|2|3|",
    // 分隔行首格恰为单 `-`：与列表起始歧义
    "a | b\n- | -\n1 | 2",
    "a | b\n- | - |\n1 | 2",
    "| a | b |\n- | -\n| 1 | 2 |",
    "a | b\n - | -\n1 | 2",
    "a | b\n- | ---\n1 | 2",
  );

  // ---------------------------------------------- 8. 定义行形似但目标后带杂质
  add(
    "[1]: https://example.com |\n\n[ref][1]",
    "| h |\n| --- |\n| [ref][1] |\n\n[1]: https://example.com |",
    "[1]: /u extra\n\n[1]",
    "- [1]: /u |\n\n[x][1]",
    "> [1]: /u |\n\n[x][1]",
    "text\n\n[1]: /u |\n\ntext",
    "[1]: /u |\n\n[1]",
    "[a b]: /u |\n\n[a b]",
  );

  // ---------------------------------------- 9. frontmatter 后无空行紧邻各块
  for (const tail of [
    ":::tip\nx\n:::",
    "# h",
    "- item",
    "1. item",
    "> quote",
    "| a |\n| --- |\n| 1 |",
    "---",
    "<div>x</div>",
  ]) {
    add(`---\nk: v\n---\n${tail}`);
  }

  // ------------------------------------------------------ 10. 首行 BOM（U+FEFF）
  add(
    "\uFEFF",
    "\uFEFF# H",
    "\uFEFFtext",
    "\uFEFF---\nkey: v\n---",
    "\uFEFF---\nkey: v\n---\nbody",
    "\uFEFF| a |\n| --- |\n| 1 |",
    "\uFEFF:::tip\nx\n:::",
    "\uFEFF- item",
    "\uFEFF> q",
  );

  // ------------------------------------------- 11. 连续 `---` 与 frontmatter 正则
  add(
    "---\n---\n",
    "---\n---\n\n---\n",
    "---\n---\n---\n",
    "---\n---\n---\n\ntext",
    "---\n---\n\n---\n\ntext",
    "---\n---\n\n---\n\n---\n",
    "---\n---\n\n---\n\n---\n\ntext",
    "---\n---\n\ntext\n\n---\n\ntext",
    "---\n---\nx\n\n---\n\ny",
    "---\n---\n\nx\n---\n\ny",
    "---\n---\nkey: v\n---\n\ntext",
    "---\n---\n\n---\nkey: v\n---\n\ntext",
  );

  return [...new Set(cases)];
}
