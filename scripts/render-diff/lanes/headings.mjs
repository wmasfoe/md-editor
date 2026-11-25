/**
 * @file headings.mjs
 * @description 渲染差分固定语料：标题 / slug / 去重 / anchor 维度。
 *
 * 为什么需要它：标题是目标点名要求字节级对齐的语法，而它的分歧几乎全部来自
 * **两个正交维度**——(1) 识别：`#` 后跟什么算分隔符（Unicode 空白、LS/PS/NEL、
 * 不可见字符）、setext 下划线与列表/占位符行的交互；(2) slug：哪些字符进 id、
 * 空白如何折叠、CJK/组合字符/emoji 如何处理、重复标题的去重后缀。两侧用不同
 * 库（marked vs comrak）实现，只能靠大规模字符集枚举才能把「已对齐」变成可证的
 * 事实，而不是抽样乐观。
 *
 * 语料来自 8 路并行探针的 L6 lane（原 `/tmp/l6.mjs`），只保留用例生成部分；
 * 固定种子的伪随机组合也一并保留，保证可复现。
 *
 * 唯一的归一化：原探针把变体名写成 `# a${space} // BOM` 这样的调试后缀直接拼进
 * markdown。固化时去掉了 ` // <名字>` 后缀，因为名字只是定位用的标签，拼进输入
 * 反而会掩盖 `# a${space}`（标题以 Unicode 空白结尾）这一维度本身。
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
 * 生成 L6 全量语料（去重，保持首次出现顺序）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const seen = new Set();
  const cases = [];
  const add = (...items) => {
    for (const item of items) {
      if (typeof item !== "string") throw new Error(`异常用例: ${JSON.stringify(item)}`);
      if (seen.has(item)) continue;
      seen.add(item);
      cases.push(item);
    }
  };
  const addAll = (items) => add(...items);

  // ── A. ATX 基础形态（1-7 个 #、分隔、收尾） ───────────────────────
  for (let level = 1; level <= 7; level += 1) {
    const hashes = "#".repeat(level);
    add(
      `${hashes} a`,
      `${hashes} 两个空格`,
      `${hashes}a`,
      `${hashes} a ${hashes}`,
      `${hashes} a ${"#".repeat(Math.max(1, level - 1))}`,
      `${hashes} a ###`,
      `${hashes} a   `,
      `${hashes}   `,
      `${hashes}`,
      `${hashes} `,
      `${hashes}\na`,
      `  ${hashes} a`,
      `   ${hashes} a`,
      `    ${hashes} a`,
      `\t${hashes} a`,
      `${hashes} a\tb`,
      `${hashes} a  b`,
      `${hashes} 中文标题`,
      `${hashes} a #`,
      `${hashes} a # `,
      `${hashes} a ## `,
      `${hashes} #`,
      `${hashes} ##`,
      `${hashes}\ta`,
      `${hashes}(a)`,
      `${hashes}（中文括号）`,
    );
  }
  // 转义 / 反斜杠
  add(
    "# a\\#",
    "# \\#a",
    "# \\*a",
    "# \\_a",
    "# \\`a",
    "# \\\\a",
    "# \\\\",
    "# \\",
    "# \\[a\\]",
    "# \\<a>",
    "# \\&amp;",
    "# \\!",
    "# a\\.",
    "# a\\-b",
    "# \\a",
    "# a\\\\b",
    "# a\\ b",
    "# <b>x</b>\\",
    "**\\***",
  );
  // 空 / 纯空白标题
  add(
    "#",
    "# ",
    "#  ",
    "######",
    "#\n#\n#",
    "#\n\n#",
    "#\n\n#\n\n#",
    "#\t",
    "#\t\n",
    "#\r\n",
    "# \r\n",
  );

  // 非 ASCII 空白作为 `#` 后的分隔符（marked `\s` vs comrak 的判定差异）
  const unicodeSpaces = [
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2002",
    "\u2009",
    "\u200a",
    "\u200b",
    "\u200c",
    "\u200d",
    "\u2028",
    "\u202f",
    "\u205f",
    "\u3000",
    "\ufeff",
    "\u000b",
    "\u000c",
  ];
  for (const space of unicodeSpaces) {
    add(`#${space}a`, `# ${space}a`, `# a${space}b`, `# a${space}`, `a${space}b\n===`);
  }

  // ── B. Setext（正确用单换行连接） ────────────────────────────────
  const setextBodies = [
    "text",
    "Text",
    "a b",
    "a  b",
    "中文",
    "a",
    "1",
    "_a_",
    "**a**",
    "`a`",
    "[a](b)",
    "![a](b)",
    "a < b",
    "a & b",
    "a\\\nb",
    "  indented",
    "a\t",
    "a  ",
    "a #",
    "a#",
    "a | b",
    "😀",
  ];
  const setextUnderlines = [
    "===",
    "---",
    "=",
    "-",
    "======",
    "--- ",
    "==  ",
    "\t---",
    "  ---",
    "   ===",
    "    ---",
    "- - -",
    "***",
    "___",
    "===",
  ];
  addAll(product(setextBodies, setextUnderlines, "\n"));

  // 多行 / 边界 setext
  add(
    "line1\nline2\n===",
    "line1\nline2\n---",
    "line1\n line2\n---",
    "line1\n  line2\n---",
    "line1\n\nline2\n===",
    "line1\nline2\nline3\n===",
    "a\n\n===",
    "a\n\n---",
    "===",
    "---",
    "---\na",
    "===\na",
    "a\n---\nb",
    "a\n===\nb",
    "a\n---\n---",
    "a\n===\n===",
    "> a\n> ---",
    "> a\n> ===",
    "> a\n---",
    "text\n===\ntext",
    "text\n---\ntext2\n===",
    "a\nb\n===\nc",
    "# a\n===",
    "# a\n---",
    "# a\n\n===",
    "```\na\n```\n===",
    "| a |\n| --- |\n===",
    "a\n===\n\n===",
    "a\n===\n\n---",
  );

  // ── C. 标题内行内语法 ────────────────────────────────────────────
  const inlineSnippets = [
    "**粗体**",
    "__粗体__",
    "*斜体*",
    "_斜体_",
    "***粗斜***",
    "~~删除~~",
    "`code`",
    "`` a`b ``",
    "[链接](https://example.com)",
    "![图片](a.png)",
    "$x^2$",
    "$ a+b $",
    "$$x$$",
    "<kbd>Ctrl</kbd>",
    "<br>",
    '<span title="a>b">x</span>',
    "&amp;",
    "&lt;",
    "&#65;",
    "中文内容",
    "😀 emoji",
    "🇨🇳 旗帜",
    "👨‍👩‍👧 ZWJ",
    "e\u0301 组合",
    "a\tb",
    '<a href="x">链接</a>',
    "<b>**粗**</b>",
    "**中文**中文",
    "中文**粗体**结尾",
    "`**not bold**`",
    "~~`code`~~",
    "==高亮==",
    "==",
    "a==b==c",
    "**a\nb**",
    "*a\nb*",
    "`a\nb`",
  ];
  for (const snippet of inlineSnippets) {
    add(
      `# ${snippet}`,
      `## ${snippet}`,
      `# before ${snippet} after`,
      `${snippet}\n===`,
      `${snippet}\n---`,
    );
  }
  // 引用式链接定义
  add(
    "# [链接][ref]\n\n[ref]: https://example.com",
    "# ![图片][img]\n\n[img]: a.png",
    "# [ref]\n\n[ref]: https://example.com",
    "# [Ref]\n\n[REF]: https://example.com",
    "# x\n\n[ref]: https://example.com",
  );

  // ── D. slug 特殊字符 ──────────────────────────────────────────────
  const slugChars = [
    "<",
    ">",
    "&",
    '"',
    "'",
    "/",
    "\\",
    ".",
    ":",
    "?",
    "!",
    "(",
    ")",
    "[",
    "]",
    "#",
    "*",
    "_",
    "-",
    " ",
    "  ",
    "   ",
    "中文",
    "日本語",
    "한국어",
    "，",
    "。",
    "！",
    "？",
    "“”",
    "（）",
    "【】",
    "、",
    "～",
    "—",
    "⇒",
    "©",
    "€",
    "°",
    "+",
    "=",
    "%",
    "^",
    "~",
    "|",
    "{",
    "}",
    ";",
    ",",
    "@",
    "$",
    "0",
    "９",
    "Ⅻ",
    "١٢٣",
    "Ω",
    "ß",
    "İ",
    "ẞ",
    "नमस्ते",
    "🐛",
    "👍🏽",
    "a\u0301",
    "\u0903",
    "\u200b",
    "\u200c",
    "\u200d",
    "\ufeff",
    "\u00ad",
    "\u2060",
  ];
  for (const ch of slugChars) {
    add(`# a${ch}b`, `# ${ch}`, `# ${ch}${ch}`, `# a ${ch} b`, `# ${ch}a`, `# a${ch}`);
  }
  add(
    "# snake_case",
    "# _under_score_",
    "# a--b",
    "# a---b",
    "# -a-",
    "# --a--",
    "# a - b",
    "# a -b",
    "# A",
    "# a",
    "# A B",
    "# Ａ全角",
    "#　　全角空格",
    "# a\u00a0b",
    "# a\u200bb",
    "# a\u200db",
    "# a\ufeffb",
    "# a\u00adb",
    "# a\u2060b",
    "# 🤔",
    "# 🤔 标题",
    "# 🇨🇳",
    "# e\u0301",
    "# e\u0301e\u0301",
    "# नमस्ते विश्व",
    "# שלום",
    "# مرحبا",
    "# ไทย",
  );

  // ── E. 重复标题 / 去重后缀 ───────────────────────────────────────
  const dupBases = ["A", "a", "text", "中文", "a b", "_x_", "`x`", "a-1", "a 1", "a_1"];
  for (const base of dupBases) {
    add(
      `# ${base}\n\n# ${base}`,
      `# ${base}\n\n# ${base}\n\n# ${base}`,
      `# ${base}\n\n## ${base}`,
      `## ${base}\n\n# ${base}\n\n### ${base}`,
    );
  }
  add(
    "# a\n\n# a\n\n# a-1",
    "# a\n\n# a-1\n\n# a",
    "# a-1\n\n# a\n\n# a",
    "# a\n\n# a\n\n# a-1\n\n# a-1\n\n# a-2",
    "# 标题\n\n# 标题\n\n# 标题",
    "# **a**\n\n# a",
    "# `a`\n\n# a",
    "# a\n\n# a ",
    "# a\n\n#A",
    "# a\n\n# a\n",
    "#\n\n#",
    "#\n\n#\n\n#",
    "# !\n\n# ?",
    "# !\n\n# ？",
    "# !!\n\n# !!",
    "# ...\n\n# ...\n\n# ...",
    "a\n===\n\n# a",
    "# a\n\na\n===",
    "a\n---\n\na\n===",
    "# a\n\n# a\n\n# a\n\n# a\n\n# a\n\n# a\n\n# a\n\n# a\n\n# a\n\n# a\n\n# a",
  );

  // ── F. 标题在容器内 ─────────────────────────────────────────────
  const containerTemplates = [
    (h) => `> ${h}`,
    (h) => `> ${h}\n> text`,
    (h) => `> a\n>\n> ${h}`,
    (h) => `- ${h}`,
    (h) => `- ${h}\n- b`,
    (h) => `1. ${h}`,
    (h) => `- item\n\n  ${h}`,
    (h) => `- item\n\n  ${h}\n\n  text`,
    (h) => `> - ${h}`,
    (h) => `- > ${h}`,
  ];
  const containerHeads = [
    "# a",
    "## 中文",
    "# a #",
    "#",
    "# <b>x</b>",
    "a\n===",
    "a\n---",
    "a\n  ===",
  ];
  for (const template of containerTemplates) for (const head of containerHeads) add(template(head));

  // 容器内 setext 的额外形态
  add(
    "- a\n===",
    "- a\n---",
    "- a\n  ===",
    "- a\n\n  ===",
    "- a\n===\n- b",
    "1. a\n===",
    "- item\n\n  a\n===",
    "- item\n\n  a\n===\n\n  text",
    "> - a\n===",
    "- > a\n===",
    "> > a\n> > ===",
    "- a\n\n  ---",
    "- a\n\n  ===\n\n  # b",
    "* a\n  ---",
    "+ a\n===",
    "- ```\n  x\n  ```\n===",
    "> a\n===\n> b",
  );

  // callout 内标题（含 comrak 不支持的 INFO / DANGER）
  const callouts = ["NOTE", "TIP", "WARNING", "CAUTION", "IMPORTANT", "INFO", "DANGER"];
  for (const kind of callouts) {
    add(
      `> [!${kind}]\n> # a`,
      `> [!${kind}]\n>\n> ## a\n>\n> text`,
      `> [!${kind}] 标题\n> # a`,
      `> [!${kind}]\n> text\n> # a`,
      `> [!${kind}]\n> # a\n> # b`,
      `> [!${kind}]\n> - # a`,
      `> [!${kind}]\n> a\n> ===`,
    );
  }

  // 表格内 # 不是标题
  add(
    "| # a | b |\n| --- | --- |\n| c | d |",
    "| a |\n| - |\n| # b |",
    "| a | b |\n|---|---|\n| # c | # d |",
    "text | # a\n--- | ---\n# b | c",
    "| a |\n|---|\n| # b\n\n# c",
    "| a | # b |\n| --- | --- |\n\n# c",
  );

  // HTML 块 / 代码块内标题
  add(
    "<div>\n# a\n</div>",
    "<div>\n\n# a\n\n</div>",
    "```\n# a\n```",
    "~~~\n# a\n~~~",
    "    # a",
    "     # a",
    "```md\n# a\n```\n\n# a",
    "<!-- # a -->\n\n# a",
    "<h1>raw</h1>\n\n# a",
    "<div>\n\n# a",
    "# a\n\n<div>\n# b\n</div>",
  );

  // ── G. 空 slug / 纯标点标题 ──────────────────────────────────────
  const punctOnly = [
    "!",
    "?",
    ".",
    "...",
    "-",
    "--",
    "_",
    "__",
    "*",
    "**",
    "***",
    "~",
    "~~",
    "`",
    "/",
    "\\",
    "()",
    "[]",
    "<>",
    "&",
    ":",
    "：",
    "？？",
    "！！",
    "（）",
    "“”",
    "、",
    "—",
    "…",
    "·",
    "•",
    "©",
    "™",
    "➔",
    "→",
    "#",
    "##",
    "=",
    "+",
    "%",
    "$",
    "^",
    "@",
    "|",
    "{",
    "}",
    ";",
    "'",
    '"',
  ];
  for (const p of punctOnly) add(`# ${p}`, `# ${p}\n\n# ${p}`, `# a ${p}`, `# ${p} a`);
  add(
    "# <b></b>",
    "# <b></b>\n\n# <i></i>",
    "# ****",
    "# ____",
    "# ``",
    "# ![](a.png)",
    "# []()",
    "# [](#)",
    "# [ ]",
    "#  ",
    "#\t",
    "# ****\n\n# ____\n\n# ``",
  );

  // ── H. legacy 别名 ───────────────────────────────────────────────
  const legacySamples = [
    "snake_case",
    "中文标题",
    "中文 标题",
    "a_b c_d",
    "**bold**",
    "`code`",
    "[link](https://x.com)",
    "![img](a.png)",
    "a & b",
    "e\u0301",
    "日本語",
    "한국어",
    "Привет",
    "a.b.c",
    "1.2.3",
    "a/b",
    "Ä",
    "İstanbul",
    "  spaced  ",
    "a-b c_d",
    "_a_b_",
    "<b>x</b>",
  ];
  for (const sample of legacySamples) add(`# ${sample}`, `# ${sample}\n\n# ${sample}`);
  add(
    "# snake_case\n\n# snakecase",
    "# snakecase\n\n# snake_case",
    "# a b\n\n# a-b",
    "# a-b\n\n# a b",
    "# 中文 标题\n\n# 中文-标题",
    "# 中文-标题\n\n# 中文 标题",
    "# a_b\n\n# a-b\n\n# ab",
    "# a_b\n\n# a.b",
    "# a.b\n\n# a_b",
    "# a b\n\n# a  b",
    "# a  b\n\n# a b",
    "> # 手順\n\n# 手順",
    "# 手順\n\n> # 手順",
    "> # a b\n\n# a-b",
    "# a-b\n\n> # a b",
    "# a_b\n\n# a_b\n\n# ab",
    "# a.b\n\n# a_b\n\n# a-b",
  );

  // ── I. 组合爆破 ─────────────────────────────────────────────────
  const headForms = [
    "# a",
    "# 中文",
    "# a b",
    "a\n===",
    "> # a",
    "- # a",
    "# snake_case",
    "# a #",
    "#",
    "# <b>x</b>",
    "a\n---",
  ];
  for (const left of headForms) for (const right of headForms) add(`${left}\n\n${right}`);

  // ── J. 伪随机组合（确定性，覆盖 slug 字符叠加） ──────────────────
  let seed = 20240613;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const alphabet = [
    "a",
    "Z",
    "0",
    " ",
    "_",
    "-",
    ".",
    "中",
    "文",
    "ｱ",
    "한",
    "é",
    "😀",
    "*",
    "`",
    "~",
    "(",
    ")",
    "[",
    "]",
    "<",
    ">",
    "&",
    "#",
    "/",
    "\\",
    ",",
    "：",
    "“",
    "”",
    "\t",
    "===",
    "**",
    "![i](p)",
    "[l](u)",
    "\u00a0",
    "\u200d",
  ];
  for (let index = 0; index < 220; index += 1) {
    const length = 1 + Math.floor(random() * 5);
    let text = "";
    for (let k = 0; k < length; k += 1) text += alphabet[Math.floor(random() * alphabet.length)];
    const hashes = "#".repeat(1 + Math.floor(random() * 6));
    add(`${hashes} ${text}`, `${hashes}${text}`);
    if (index % 5 === 0) add(`${hashes} ${text}\n\n${hashes} ${text}`);
  }

  // ── K. 补充：`#` 后的 Unicode 分隔符 / 转义在标题开头 / 首尾空白矩阵 ──
  const extraSpaces = ["\u0085", "\u2028", "\u2029"];
  for (const space of extraSpaces) {
    add(`#${space}a`, `# a${space}b`, `# a${space}`);
  }
  // 标题开头的转义（全部 ASCII 标点）
  for (const ch of "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~") {
    add(`# \\${ch}a`, `# a\\${ch}b`);
  }
  // 标题内容首尾的 Unicode 空白（配合 ASCII 空格，两侧都识别为标题）
  for (const space of [
    "\u00a0",
    "\u1680",
    "\u2003",
    "\u205f",
    "\u3000",
    "\u000b",
    "\u000c",
    "\ufeff",
    "\u202f",
  ]) {
    add(
      `# ${space}a`,
      `# a${space}`,
      `# ${space}a${space}`,
      `> # ${space}a`,
      `- # ${space}a`,
      `# ${space}a\n\n# ${space}a`,
      `${space}a\n===`,
    );
  }

  // ── L. 占位符行 + setext / 行分隔符矩阵 ─────────────────────────
  add(
    "[a]: https://x\n===",
    "[a]: https://x\n---",
    "[a]: u\n=== \n",
    "x\n\n[a]: u\n===",
    "\ufeffa\n===",
    "\ufeff# a\n===",
    "\ufeffa\n===\n\n\ufeffb\n===",
    "a\n===\n\n[b]: u\n===",
    "\ufeffa\n---",
    "\ufeff标题\n===",
  );
  for (const space of ["\u2028", "\u2029", "\u0085"]) {
    add(
      `#${space}a`,
      `# ${space}a`,
      `# a${space}b`,
      `# a${space}`,
      `${space}a\n===`,
      `a${space}b\n===`,
    );
  }

  return cases;
}
