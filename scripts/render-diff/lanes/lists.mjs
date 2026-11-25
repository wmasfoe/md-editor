/**
 * @file lists.mjs
 * @description 渲染差分固定语料：列表 / 任务列表 / 缩进 / 续行维度。
 *
 * 为什么需要它：列表是「缩进即语义」的语法，两侧实现的差异集中在**边界判定**——
 * 标记互换（`-`/`*`/`+` 混用）、起始序号（`0.` / `999.` / 数字跳跃）、tight 与
 * loose 的分界、嵌套缩进宽度（1/2/3/4 空格与 tab）、续行的惰性/对齐规则、
 * 空列表项、列表项承载块级内容。这些不是「想到就能写全」的，必须按维度枚举；
 * 历史上该 lane 一次性暴露了数十例「续行缩进归属」与「列表内表格/setext」分歧。
 *
 * 语料来自 8 路并行探针的 L3 lane（原 `/tmp/l3.mjs`），只保留用例生成部分；
 * 固定种子的随机组合也一并保留，保证同一份套件每次生成相同输入。
 *
 * 用法：由 `scripts/render-diff/lanes/run.mjs` 汇总运行，不单独执行。
 */

/** 列表项正文候选（含续行形态）。 */
const ITEM_BODIES = [
  "apples",
  "apples and oranges",
  "**bold**",
  "`code`",
  "apples\n  continued",
  "apples\n continued",
];

/** 缩进宽度候选。 */
const INDENTS = [" ", "  ", "   ", "    ", "\t"];

/** 列表项内承载的块级内容。 */
const BLOCKS = [
  "```js\nconst a = 1;\n```",
  "    indented code",
  "> quoted",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "<div>\nhi\n</div>",
  "## H2",
  "---",
  "$$\nx\n$$",
  "  - x\n  - y",
  "second para",
];

/** 生成 `depth` 层嵌套列表。 */
function nested(depth, indent, marker) {
  const lines = [];
  for (let d = 0; d < depth; d += 1) lines.push(`${indent.repeat(d)}${marker} level${d}`);
  return lines.join("\n");
}

/** 固定种子 PRNG（mulberry32），保证随机组合可复现。 */
function seededRandom(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成 L3 全量语料（去重，保持首次出现顺序）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const collected = [];
  const add = (...markdowns) => {
    for (const markdown of markdowns) collected.push(markdown);
  };

  // ── 1. 无序列表标记互换 ────────────────────────────────────────────────
  for (const marker of ["-", "*", "+"]) {
    for (const body of ITEM_BODIES) add(`${marker} ${body}`);
    add(`${marker} a\n${marker} b`);
    add(`${marker} a\n${marker} b\n${marker} c`);
  }
  for (const marker of ["-", "*", "+"]) {
    for (const body of ["a", "**b**", "a\n  cont"]) add(`${marker} ${body}\n${marker} second`);
  }
  // 同一列表混用不同标记
  const MIX = [
    ["-", "*"],
    ["*", "-"],
    ["+", "*"],
    ["-", "+"],
    ["*", "+"],
    ["+", "-"],
  ];
  for (const [a, b] of MIX) add(`${a} a\n${b} b`);
  add("- a\n* b\n+ c", "+ a\n- b\n* c", "* a\n+ b\n- c");
  add("- a\n* b\n- c\n* d");
  add("- a\n\n* b", "* a\n\n- b", "+ a\n\n- b");
  add("- a\n* b\n\n- c");

  // ── 2. 有序列表：格式 / 起始数字 / 数字跳跃 ────────────────────────────
  add(
    "1. a\n2. b",
    "1. a\n1. b",
    "1. a\n5. b",
    "1. a\n9. b\n10. c",
    "5. a\n6. b",
    "5. a\n1. b",
    "0. a\n1. b",
    "999. a\n1000. b",
    "999. a",
    "10. a\n11. b",
    "1) a\n2) b",
    "1) a\n5) b",
    "1. a\n2) b",
    "1) a\n2. b",
    "1. a\n2. b\n3. c",
    "1. a\n3. b\n2. c",
    "3. a\n1. b\n2. c",
    "1. a\n\n2. b",
    "5. a\n\n6. b",
    "999. a\n\n1000. b",
    "1) a\n\n2) b",
    "1. **a**\n2. `b`",
    "1. a\n   cont\n2. b",
    "1. a\n1) b",
    "- a\n1. b",
    "1. a\n- b",
    "1. a\n  - b",
    "- a\n  1. b",
  );

  // ── 3. tight vs loose ────────────────────────────────────────────────
  add(
    "- a\n- b",
    "- a\n\n- b",
    "- a\n- b\n\n- c",
    "- a\n\n- b\n\n- c",
    "1. a\n2. b",
    "1. a\n\n2. b",
    "1. a\n2. b\n\n3. c",
    "- a\n\n  second paragraph\n- b",
    "- a\n\n  second paragraph\n\n  third\n- b",
    "- a\n  - x\n- b",
    "- a\n\n  - x\n- b",
    "- a\n  - x\n\n- b",
    "* a\n\n* b",
    "+ a\n\n+ b",
    "- a\n\n- b\n  - c",
    "1. a\n\n   para\n2. b",
    "- a\n\n  ```js\n  x\n  ```\n- b",
    "- a\n\n  > q\n- b",
  );

  // ── 4. 嵌套深度 × 缩进宽度 ───────────────────────────────────────────
  for (const depth of [2, 3, 4]) {
    for (const indent of INDENTS) {
      add(nested(depth, indent, "-"));
      add(nested(depth, indent, "1."));
    }
  }
  add(
    "- a\n  - b\n- c",
    "- a\n  - b\n  - b2\n- c",
    "1. a\n   1. b\n      1. c",
    "- a\n  - b\n    - c\n      - d\n- e",
    "- a\n  1. b\n  2. c\n- d",
    "1. a\n   - b\n   - c\n2. d",
    "- a\n  * b\n  + c",
    "- a\n  - b\n\n  - c\n- d",
    "- a\n\n  - b\n  - c\n- d",
    "- a\n    - b",
    "- a\n   - b",
    "- a\n \t- b",
    "- a\n\t- b\n\t- c",
    "1. a\n\n   1. b",
    "- a\n  - b\n    - c\n      - d\n        - e",
  );

  // ── 5. 任务列表 ────────────────────────────────────────────────────
  add(
    "- [ ] a",
    "- [x] a",
    "- [X] a",
    "- [ ]",
    "- [x]",
    "- [X]",
    "- [ ] ",
    "- [x] ",
    "- [ ]  a",
    "- [x]   a",
    "* [ ] a",
    "+ [x] a",
    "- [ ] a\n- [x] b",
    "- [x] a\n- [ ] b",
    "- [ ] a\n- b",
    "- a\n- [x] b",
    "- [ ] a\n- [ ] b\n- [ ] c",
    "- [ ] a\n\n- [x] b",
    "- [x] a\n\n- [ ] b",
    "- [ ] a\n\n- b",
    "- [ ] a\n\n  second paragraph\n- [x] b",
    "- [ ] a\n  - [x] b",
    "- [x] a\n  - [ ] b\n  - [x] c",
    "1. [ ] a",
    "1. [x] a\n2. [ ] b",
    "1. [x] a\n\n2. [ ] b",
    "- [ ] **bold**",
    "- [x] `code`",
    "- [ ] a\n- [x] b\n- c\n- [ ] d",
    "- [ ] `a` and [link](http://x)",
    "- [x] a\n  continued\n- [ ] b",
    "- [ ] a\n\n  ```js\n  x\n  ```\n- [x] b",
    "- [ ] a\n\n  > quoted\n- [x] b",
    "> - [ ] a\n> - [x] b",
    "> - [x] a",
    "- [ ]\n- [x]\n- [ ]",
    "- [ ] a\n\n- [ ] b",
    "- [x] a\n- [x] b\n- [ ] c",
    "- [ ]",
    "- [x] a\n\n  para",
    "- [ ] a\n  - [ ] b\n    - [x] c",
    "- [x] a\n- b\n- [ ] c",
    "1) [ ] a\n2) [x] b",
  );

  // ── 6. 项内包含各种块 ────────────────────────────────────────────────
  for (const block of BLOCKS) {
    const indented = block
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n");
    add(`- a\n\n${indented}`, `- a\n${indented}`, `1. a\n\n${indented}`);
    add(`- a\n\n${indented}\n- b`, `- ${block.replace(/\n/g, "\n  ")}\n- b`);
  }

  // ── 7. 续行缩进 ───────────────────────────────────────────────────
  for (const indent of INDENTS) {
    add(
      `- apples\n${indent}oranges`,
      `- apples\n${indent}oranges\n${indent}bananas`,
      `1. apples\n${indent}oranges`,
      `- a\n${indent}b\n- c`,
    );
  }
  add(
    "- a  \nb",
    "- a\\\nb",
    "- long paragraph that keeps going\n  and going\n  and going\n- b",
    "- a\n\n  para one\n  continues\n- b",
    "1. a\n   b\n   c\n2. d",
    "1. a\n  b",
    "1. a\n    b",
    "- a\n  b\n   c",
    "- a\n   b\n  c",
  );

  // ── 8. 空列表项 ────────────────────────────────────────────────────
  add(
    "-",
    "- ",
    "1.",
    "1. ",
    "*",
    "+",
    "- \n- a",
    "- a\n-",
    "- a\n-\n- b",
    "1.\n2.",
    "1.\n2. a",
    "- a\n- \n- b",
    "-\n-\n-",
    "1. \n2. ",
    "- a\n\n-\n\n- b",
  );

  // ── 9. 列表与段落相邻 ───────────────────────────────────────────────
  add(
    "- a\npara",
    "- a\n\npara",
    "para\n- a",
    "para\n\n- a",
    "1. a\npara",
    "1. a\n\npara",
    "para\n1. a",
    "para\n\n1. a",
    "- a\n# H1",
    "# H1\n- a",
    "- a\n> q",
    "> q\n- a",
  );

  // ── 10. 引用块 × 列表 ──────────────────────────────────────────────
  add(
    "> - a\n> - b",
    "> 1. a\n> 2. b",
    "> para\n>\n> - a",
    "> - a\n>\n> - b",
    "- a\n\n  > quoted",
    "- > quoted\n- > quoted2",
    "> - a\n>   - b",
    "> - [ ] a\n> - [x] b",
    "- a\n\n  > q1\n  >\n  > q2",
    "> 1. a\n>\n> 2. b",
  );

  // ── 11. 固定种子随机组合（补足样本量） ───────────────────────────────
  const random = seededRandom(20240607);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const MARKERS = ["-", "*", "+", "1.", "1)", "5.", "999."];
  const BODY_POOL = [
    "a",
    "**bold**",
    "`code`",
    "[link](http://x)",
    "[ ] a",
    "[x] a",
    "[X] a",
    "",
    "a b c",
  ];
  const CONT_POOL = ["b", "  b", " b", "   b", "\tb"];

  for (let i = 0; i < 120; i += 1) {
    const marker = pick(MARKERS);
    const count = 1 + Math.floor(random() * 4);
    const loose = random() < 0.4;
    const nest = random() < 0.35;
    const lines = [];
    for (let k = 0; k < count; k += 1) {
      lines.push(`${marker} ${pick(BODY_POOL)}`.trimEnd());
      if (random() < 0.3) lines.push(pick(CONT_POOL));
      if (nest && random() < 0.5)
        lines.push(`  ${pick(["-", "*", "1."])} ${pick(BODY_POOL)}`.trimEnd());
      if (loose && k < count - 1) lines.push("");
    }
    add(lines.join("\n"));
  }

  for (let i = 0; i < 80; i += 1) {
    const block = pick(BLOCKS);
    const indented = block
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n");
    const marker = pick(["-", "*", "1."]);
    const body = pick(BODY_POOL);
    const mode = random();
    let markdown;
    if (mode < 0.34) markdown = `${marker} ${body}\n\n${indented}`;
    else if (mode < 0.67) markdown = `${marker} ${body}\n${indented}`;
    else markdown = `${marker} ${body}\n\n${indented}\n${marker} tail`;
    add(markdown);
  }

  return [...new Set(collected)];
}
