/**
 * @file fuzz.mjs
 * @description 渲染差分的组合式 fuzz 套件。
 *
 * 为什么需要它：手写语料只能覆盖「想到的」形态。fuzz 用系统化的笛卡尔积与
 * 固定种子的随机组合，覆盖语法交错出现的真实场景——历史上一半以上的分叉
 * 是通过这里发现的（highlight 嵌套、容器内定义行、列表续行缩进等）。
 *
 * 设计原则：
 * 1. **固定种子**，结果可复现，失败可直接定位到具体输入。
 * 2. 与 `KNOWN_DIVERGENCES.md` 联动：命中登记项的不计入失败，但会单独列出，
 *    避免「绿测掩盖未登记差异」。
 * 3. 每条用例都双跑 TS 与 Rust，逐字节比较。
 *
 * 用法：`node --experimental-strip-types scripts/render-diff/fuzz.mjs`
 * 退出码非 0 表示存在未登记分歧。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repoRoot);

const { renderStaticHtml } = await import("../../packages/compiler/src/index.ts");

/** 固定种子 PRNG（mulberry32），保证同一份套件每次生成相同的输入。 */
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

/** 用 Rust 渲染器批量渲染。 */
function renderWithRust(markdowns) {
  const fixtures = markdowns.map((markdown, index) => ({ id: `f${index}`, markdown }));
  const stdout = execFileSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", "crates/render/Cargo.toml", "--bin", "render-fixtures"],
    {
      cwd: repoRoot,
      input: JSON.stringify({ fixtures }),
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout);
  return markdowns.map((_, index) => parsed.results[`f${index}`]);
}

/**
 * 已登记分歧（见 KNOWN_DIVERGENCES.md）。
 *
 * 命中时不计入失败但会单独列出，保证「接受的分歧」是显式的。
 */
const KNOWN_DIVERGENCES = [
  {
    id: "KD-4",
    // 四冒号嵌套指令：TS 的正则回溯把首尾多余冒号当作文本，Rust 整体保留字面量。
    test: (markdown) => /^:{4,}/m.test(markdown),
  },
  {
    id: "KD-1/KD-3",
    // 两个 `$$` 块相邻或被内容隔开：TS 的跨块匹配会吞掉中间内容或产出 katex-error。
    test: (markdown, tsHtml, rustHtml) =>
      (tsHtml.match(/math-display/g) ?? []).length !==
        (rustHtml.match(/math-display/g) ?? []).length ||
      (tsHtml.includes("katex-error") && !rustHtml.includes("katex-error")),
  },
];

/** 定义各套件。每个套件返回 markdown 字符串数组。 */
const SUITES = {
  /** 行内语法 × 块级容器。 */
  inline: () => {
    const atoms = [
      "**b**",
      "*i*",
      "~~d~~",
      "==h==",
      "`c`",
      "[l](u)",
      "$m$",
      "![a](p.png)",
      "==**hb**==",
      "**==bh==**",
      "a **b** c",
      "x ==y== z",
      "a==b==c",
    ];
    const containers = [
      (s) => s,
      (s) => `# ${s}`,
      (s) => `> ${s}`,
      (s) => `- ${s}`,
      (s) => `1. ${s}`,
      (s) => `| h |\n| --- |\n| ${s.replaceAll("|", "\\|")} |`,
      (s) => `> [!NOTE]\n> ${s}`,
      (s) => `:::tip\n${s}\n:::`,
    ];
    const out = [];
    for (const atom of atoms) for (const wrap of containers) out.push(wrap(atom));
    return out;
  },

  /** 块级两两组合。 */
  blocks: () => {
    const blocks = [
      "# H1",
      "## H2 ##",
      "###### H6",
      "para\n\npara2",
      "- a\n- b",
      "1. a\n2. b",
      "- [ ] t\n- [x] d",
      "> q",
      "> > q2",
      "```js\nconst a=1;\n```",
      "~~~\nraw\n~~~",
      "    indented",
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
      "---",
      "***",
      "$$x$$",
      "$$\nx\n$$",
      "$$\n\n$$",
      "$$\na\n\nb\n$$",
      "> [!NOTE]\n> n",
      ":::tip\nx\n:::",
      "<div>\nx\n</div>",
      "[foo]: /u",
      "[^1]: note",
      "a@b.com",
      "&copy;",
    ];
    const out = [];
    for (const left of blocks) for (const right of blocks) out.push(`${left}\n\n${right}`);
    return out;
  },

  /** 标题内联语法 × 标题形态。 */
  headings: () => {
    const bits = [
      "**b**",
      "*i*",
      "~~d~~",
      "==h==",
      "`c`",
      "[l](u)",
      "![a](p.png)",
      "$m$",
      "==**hb**==",
      "a < b",
      "&copy;",
      "snake_case",
      "テスト",
      "**b** and *i*",
    ];
    const forms = [
      (s) => `# ${s}`,
      (s) => `## ${s} ##`,
      (s) => `> # ${s}`,
      (s) => `- # ${s}`,
      (s) => `:::tip\n# ${s}\n:::`,
    ];
    const out = [];
    for (const bit of bits) for (const form of forms) out.push(form(bit));
    return out;
  },

  /** 内联 × 容器嵌套。 */
  nesting: () => {
    const inners = [
      "para",
      "**b**",
      "`c`",
      "==h==",
      "$m$",
      "- a\n- b",
      "> q",
      "# H",
      "a@b.com",
      "[foo]: /u",
      "[^1]: n",
      "$$x$$",
      "---",
      "<div>x</div>",
    ];
    const wrappers = [
      (s) => s,
      (s) =>
        s
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      (s) =>
        s
          .split("\n")
          .map((line) => `- ${line}`)
          .join("\n"),
      (s) => `:::tip\n${s}\n:::`,
      (s) =>
        `> [!NOTE]\n${s
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`,
    ];
    const out = [];
    for (const inner of inners) for (const wrap of wrappers) out.push(wrap(inner));
    return out;
  },

  /** 强调/链接/围栏/表格边界的显式清单。 */
  edges: () => [
    "***bi***",
    "**_bi_**",
    "**a *b* c**",
    "~~**bd**~~",
    "==~~hd~~==",
    "**",
    "****",
    "~~",
    "==",
    "***",
    "***a***",
    "[a](<b c>)",
    '[a](b "t")',
    "[]()",
    "![](x)",
    "[a][b]\n\n[b]: /u",
    "```\n```",
    "````\nx\n````",
    "~~~js\nx\n~~~",
    "```js\nx",
    "| a |\n| --- |\n| b |",
    "a | b\n--- | ---\nc | d",
    "|a|\n|-|\n|b|",
    ">",
    "-",
    "1.",
    "- a\n\n- b",
    "  - a\n    - b",
    "- [ ]",
    "- [x]",
    "\\",
    "a\\\nb",
    "&",
    "&#x41;",
    "&unknown;",
    "::::note\n:::tip\nx\n:::\n::::",
    "<br>",
    "<br/>",
    "<!-- c -->",
  ],

  /** 固定种子随机组合。 */
  random: () => {
    const units = [
      "# H1",
      "## H2",
      "para text",
      "**bold**",
      "*it*",
      "`code`",
      "==hl==",
      "- item",
      "1. one",
      "- [ ] a",
      "- [x] b",
      "> quote",
      "```js\nconst a=1;\n```",
      "    indented",
      "| a | b |\n| --- | --- |\n| 1 | 2 |",
      "$$m$$",
      "$i$",
      "$$\nb\n$$",
      "> [!NOTE]\n> note",
      ":::tip\nx\n:::",
      "<div>\nx\n</div>",
      "[l](u)",
      "![i](p.png)",
      "---",
      "a@b.com",
      "[foo]: /u",
      "[^1]: n",
      "&copy;",
      "5 < 10",
      "\\*esc\\*",
    ];
    const random = seededRandom(20260101);
    const out = [];
    for (let n = 0; n < 400; n += 1) {
      const count = 2 + Math.floor(random() * 4);
      const parts = [];
      for (let i = 0; i < count; i += 1) {
        parts.push(units[Math.floor(random() * units.length)]);
      }
      out.push(parts.join("\n\n"));
    }
    return out;
  },
};

let totalUnknown = 0;
let totalKnown = 0;

for (const [name, build] of Object.entries(SUITES)) {
  const markdowns = build();
  const rustHtml = renderWithRust(markdowns);

  const unknown = [];
  const known = [];
  for (const [index, markdown] of markdowns.entries()) {
    const tsHtml = renderStaticHtml(markdown).html;
    if (tsHtml === rustHtml[index]) continue;
    const registered = KNOWN_DIVERGENCES.find((entry) =>
      entry.test(markdown, tsHtml, rustHtml[index]),
    );
    (registered ? known : unknown).push({ markdown, tsHtml, rust: rustHtml[index], registered });
  }

  totalUnknown += unknown.length;
  totalKnown += known.length;

  const status = unknown.length === 0 ? "✅" : "❌";
  console.log(
    `${status} ${name.padEnd(9)} ${String(markdowns.length).padStart(4)} 例：` +
      `未登记 ${unknown.length}，已登记 ${known.length}`,
  );

  for (const item of unknown.slice(0, 5)) {
    console.log(`\n   输入: ${JSON.stringify(item.markdown.slice(0, 80))}`);
    console.log(`   TS  : ${JSON.stringify(item.tsHtml.slice(0, 120))}`);
    console.log(`   RUST: ${JSON.stringify(item.rust.slice(0, 120))}`);
  }
  for (const item of known) {
    console.log(
      `   ℹ️  已登记 [${item.registered.id}] ${JSON.stringify(item.markdown.slice(0, 60))}`,
    );
  }
}

console.log(`\n合计：未登记分歧 ${totalUnknown}，已登记分歧 ${totalKnown}`);
process.exit(totalUnknown === 0 ? 0 : 1);
