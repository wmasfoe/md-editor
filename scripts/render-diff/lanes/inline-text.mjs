/**
 * @file inline-text.mjs
 * @description 渲染差分固定语料：CJK 强调边界 / HTML 实体 / 反斜杠转义 /
 * 段落与换行 / 行内代码。
 *
 * 为什么需要它：这一族是两套实现**最不可能天然一致**的地方——CJK 强调边界
 * （comrak 的 `cjk_friendly_emphasis` 与 marked-cjk-friendly 是两套独立实现）、
 * 命名实体的解析时机（marked 走 HTML 实体表、comrak 走另一套）、反斜杠转义的
 * 生效范围（硬换行 / 标点白名单）、行内代码与强调的相互打断。这些差异以字符
 * 邻接组合的形式出现，只能按「左邻字符 × 标记串长 × 右邻字符」枚举；历史分歧
 * 里最典型的 `\\*` 双反斜杠丢字符就是这一 lane 找出来的。
 *
 * 语料来自 8 路并行探针的 L8 lane（原 `/tmp/l8.mjs`），只保留用例生成部分。
 *
 * 用法：由 `scripts/render-diff/lanes/run.mjs` 汇总运行，不单独执行。
 */

/**
 * 生成 L8 全量语料（去重，保持首次出现顺序）。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const cases = [];
  const push = (...items) => {
    for (const item of items) cases.push(item);
  };

  // ── 1. CJK 强调边界 ────────────────────────────────────────────────
  const cjkBoundaries = [
    "",
    "中",
    "字",
    "あ",
    "カ",
    "ー",
    "한",
    "a",
    "Z",
    "1",
    "，",
    "。",
    "！",
    "？",
    "；",
    "：",
    "、",
    "（",
    "）",
    "「",
    "」",
    "『",
    "』",
    "【",
    "】",
    "—",
    "…",
  ];

  const emphMarkers = ["**", "__", "*", "_", "***", "~~"];

  for (const marker of emphMarkers) {
    for (const left of cjkBoundaries) {
      for (const right of cjkBoundaries) {
        push(`${left}${marker}中${marker}${right}`);
      }
    }
  }

  // 混合内容与中英混排
  const emphBodies = [
    "中",
    "中文",
    "中 文",
    "abc",
    "中abc",
    "abc中",
    "中 abc 文",
    "a b",
    "中，文",
    "中·文",
  ];
  for (const marker of ["**", "__", "*", "_", "~~", "***"]) {
    for (const body of emphBodies) {
      push(`${marker}${body}${marker}`);
      push(`中${marker}${body}${marker}文`);
      push(`「${marker}${body}${marker}」`);
      push(`（${marker}${body}${marker}）`);
    }
  }

  // 标点邻接强调
  for (const punct of [
    "，",
    "。",
    "！",
    "？",
    "；",
    "：",
    "、",
    "——",
    "……",
    "「",
    "」",
    "『',",
    "【",
    "】",
    "(",
    ")",
    '"',
    "'",
  ]) {
    for (const marker of ["**", "*", "~~"]) {
      push(`${punct}${marker}中${marker}${punct}`);
      push(`中${punct}${marker}中${marker}${punct}文`);
    }
  }

  // ── 2. 组合强调 ───────────────────────────────────────────────────
  push(
    "***中***",
    "***中文***",
    "***中*文**",
    "***中**文*",
    "**中*文*",
    "*中**文**",
    "*中*文*",
    "**中**文**",
    "**中***文*",
    "*中***文**",
    "___中___",
    "*** 中 ***",
    "***中 ***",
    "*** 中***",
    "**中 _文_ 字**",
    "*中 **文** 字*",
    "~~**中**文~~",
    "**~~中~~文**",
    "~~中**文**~~",
    "**中~~文~~**",
    "*中~~文~~*",
    "~~*中*~~",
    "中***中文***文",
    "中**中**中**文**文",
    "**a*中*文**",
    "*a**中**文*",
    "**中\u3000文**",
    "**中\t文**",
    "**中\n文**",
    "**中  \n文**",
    "__中__文",
    "中__文__",
    "___中__文_",
    "_中__文__",
  );

  // ── 3. HTML 实体 ─────────────────────────────────────────────────
  const entities = [
    "&copy;",
    "&#65;",
    "&#x41;",
    "&#X41;",
    "&amp;",
    "&lt;",
    "&gt;",
    "&quot;",
    "&apos;",
    "&nbsp;",
    "&foo;",
    "&copy",
    "&amp;copy;",
    "&amp;amp;",
    "&AMP;",
    "&Copy;",
    "&#0;",
    "&#1;",
    "&#9;",
    "&#10;",
    "&#13;",
    "&#32;",
    "&#160;",
    "&#65",
    "&#;",
    "&#x;",
    "&;",
    "&",
    "&&",
    "& amp;",
    "a&b",
    "&#x1F600;",
    "&#128512;",
    "&#x110000;",
    "&#999999999;",
    "&#xZZ;",
    "&notit;",
    "&not;",
    "&notin;",
    "&sub;",
    "&sup;",
    "&hearts;",
    "&hellip;",
    "&mdash;",
    "&ndash;",
    "&lsquo;",
    "&rsquo;",
    "&ldquo;",
    "&rdquo;",
    "&laquo;",
    "&raquo;",
    "&times;",
    "&divide;",
    "&deg;",
    "&plusmn;",
    "&frac12;",
    "&euro;",
    "&pound;",
    "&yen;",
    "&sect;",
    "&para;",
    "&middot;",
    "&bull;",
    "&dagger;",
    "&Dagger;",
    "&permil;",
    "&prime;",
    "&Prime;",
    "&oline;",
    "&frasl;",
    "&image;",
    "&weierp;",
    "&real;",
    "&trade;",
    "&alefsym;",
    "&larr;",
    "&uarr;",
    "&rarr;",
    "&darr;",
    "&harr;",
    "&crarr;",
    "&lArr;",
    "&rArr;",
    "&forall;",
    "&part;",
    "&exist;",
    "&empty;",
    "&nabla;",
    "&isin;",
    "&notin;",
    "&ni;",
    "&prod;",
    "&sum;",
    "&minus;",
    "&lowast;",
    "&radic;",
    "&prop;",
    "&infin;",
    "&ang;",
    "&and;",
    "&or;",
    "&cap;",
    "&cup;",
    "&int;",
    "&there4;",
    "&sim;",
    "&cong;",
    "&asymp;",
    "&ne;",
    "&equiv;",
    "&le;",
    "&ge;",
    "&sdot;",
    "&lceil;",
    "&rceil;",
    "&lfloor;",
    "&rfloor;",
    "&lang;",
    "&rang;",
    "&loz;",
    "&spades;",
    "&clubs;",
    "&diams;",
    "&yuml;",
    "&thinsp;",
    "&ensp;",
    "&emsp;",
    "&zwnj;",
    "&zwj;",
    "&lrm;",
    "&rlm;",
    "&shy;",
  ];

  for (const entity of entities) {
    push(entity);
    push(`a${entity}b`);
    push(`中文${entity}中文`);
    push(`**${entity}**`);
    push(`\`${entity}\``);
    push(`[${entity}](https://x)`);
  }

  // 实体在块级结构里
  push(
    "&copy;\n\n&copy;",
    "# &copy; 标题",
    "> &copy;",
    "- &copy;",
    "| &copy; | b |\n| --- | --- |\n| &copy; | d |",
    "```\n&copy;\n```",
    "    &copy;",
    "a &copy; b &amp; c",
    "&copy;\n&copy;",
    "&amp;lt;",
    "&amp;#65;",
    "&amp;amp;amp;",
  );

  // ── 4. 反斜杠转义 ────────────────────────────────────────────────
  const escapes = [
    "\\*",
    "\\_",
    "\\\\",
    "\\\\\\\\",
    "\\<",
    "\\&",
    "\\#",
    "\\a",
    "\\!",
    "\\.",
    "\\-",
    "\\+",
    "\\=",
    "\\|",
    "\\~",
    "\\`",
    "\\[",
    "\\]",
    "\\(",
    "\\)",
    "\\{",
    "\\}",
    "\\$",
    "\\%",
    "\\^",
    "\\@",
    "\\;",
    "\\:",
    '\\"',
    "\\'",
    "\\/",
    "\\ ",
    "\\中",
  ];

  for (const escape of escapes) {
    push(escape);
    push(`a${escape}b`);
    push(`${escape}中`);
    push(`中${escape}文`);
    push(`\\${escape}`);
    push(`**${escape}**`);
    push(`\`${escape}\``);
    push(`*a${escape}b*`);
    push(`~~${escape}~~`);
    push(`# ${escape}`);
  }

  push(
    "\\*中\\*",
    "\\*\\*中\\*\\*",
    "中\\**文**",
    "**中\\**文",
    "*\\**中**",
    "a\\\nb",
    "a\\",
    "a\\\n",
    "a\\\\\nb",
    "a\\\\\\\nb",
    "\\",
    "\\\n",
    "中\\\n文",
    "中\\",
    "```\na\\\nb\n```",
    "`a\\`b`",
    "`a\\\\b`",
    "- a\\\n  b",
  );

  // ── 5. 硬换行 ────────────────────────────────────────────────────
  push(
    "a  \nb",
    "a   \nb",
    "a    \nb",
    "a \nb",
    "a\t\nb",
    "a  \n\nb",
    "a<br>b",
    "a<br/>b",
    "a<br />b",
    "a<BR>b",
    "中  \n文",
    "中  \n中",
    "中<br>文",
    "中<br/>文",
    "**a**  \n**b**",
    "**中**  \n**文**",
    "a  \n- b",
    "- a  \n  b",
    "> a  \n> b",
    "a  \n",
    "a  ",
    "  \na",
    "a  \n  \nb",
    "中  \n  \n文",
    "a\n<br>b",
    "a<br>\nb",
    "<br>\n<br>",
    "a  \n\n<br>",
  );

  // ── 6. 段落与空白 ────────────────────────────────────────────────
  push(
    "a\nb",
    "a\n\nb",
    "a\n\n\nb",
    "a\n\n\n\nb",
    "中\n文",
    "中\n\n文",
    "a \nb",
    "a\n b",
    "a\n\tb",
    "a\n \n b",
    "a\n\t\nb",
    "a\n  \n b",
    "a\n\n \n\nb",
    "\na",
    "a\n",
    "\n\na",
    "a\n\n",
    "\na\n",
    "\na\n\n",
    "\n",
    "\n\n",
    "\n\n\n",
    " ",
    "  ",
    "\t",
    " \t ",
    "\r\n",
    "a\r\nb",
    "a\r\n\r\nb",
    "中 \t\n 文",
    "a\n\nb\n\nc",
    "a\n b\n  c",
    "  a  \n  b  ",
    "\u00a0",
    "a\u00a0\nb",
    "\u3000",
    "\u3000\n\u3000",
    "a\n\u3000\nb",
    "文档末尾有空格 ",
    " 文档开头有空格",
    "\n中间\n",
    "a\n\n\n",
    "\n\na\n\n\n",
  );

  // ── 7. 行内代码 ──────────────────────────────────────────────────
  push(
    "`a`",
    "``a``",
    "`` ` ``",
    "``a`b``",
    "`a`b`",
    "``a``b``",
    "` a `",
    "`  a  `",
    "`   `",
    "` `` `",
    "`<`",
    "`&`",
    "`&amp;`",
    "`<div>`",
    "`a b`",
    "`中`",
    "`中文 abc`",
    "`*a*`",
    "`**中**`",
    "`~~中~~`",
    "`\\*`",
    "`\\`",
    "`a\nb`",
    "`a  \nb`",
    "a`中`b",
    "中`a`文",
    "**`中`**",
    "`中`  \n`文`",
    "```a```",
    "`````",
    "`",
    "``",
    "`` `a` ``",
    "`中文``代码`",
    "中`code`中",
    "`a`中`b`",
    "`` ` ``\n\n`` ` ``",
    "`\t`",
    "`中  文`",
  );

  // 强调 × 行内代码交叉
  for (const inner of ["`a`", "``a``", "`中`", "`a b`", "`<x>`"]) {
    for (const marker of ["**", "*", "~~", "***"]) {
      push(`${marker}${inner}${marker}`);
      push(`${marker}中${inner}文${marker}`);
      push(`中${marker}${inner}${marker}文`);
    }
  }

  // 强调嵌套 × 段落/换行
  for (const sep of ["\n", "\n\n", "  \n", "\\\n"]) {
    for (const marker of ["**", "*", "~~"]) {
      push(`${marker}中${marker}${sep}${marker}文${marker}`);
      push(`中${marker}a${marker}${sep}文${marker}b${marker}`);
    }
  }

  // ── 8. 第二轮补充：空文档 / 强调边界 / 转义位置矩阵 / 引用块硬换行 ──
  push(
    "",
    "",
    "\r\n\r\n",
    "\r",
    "\u000b",
    "****",
    "** **",
    "**",
    "*",
    "~~",
    "~~~~",
    "~",
    "~a~",
    "~~a~~",
    "~中~",
    "~~~~中~~~~",
    "**中",
    "中**",
    "*中",
    "中*",
    "**中*",
    "*中**",
    "******",
    "***",
    "***a***",
    "***中***文",
    "中***",
    "***中",
    "**中****文**",
    "**a** **b**",
    "**中****文**",
    "\u3000**中**\u3000",
    "\u00a0**中**\u00a0",
    "中\u200b**文**",
    "**中**\u200b文",
    "②**中**③",
    "㈱**中**㈲",
    "①中②",
    "中①文",
    "日本語**テスト**です",
    "テスト**日本語**テスト",
    "한국어**테스트**입니다",
    "「**中**」と「**文**」",
    "**中**、**文**",
    "**中**。**文**",
    "中**abc**文",
    "abc**中**abc",
    "_中_文",
    "中_文_",
    "__中__文__",
    "a_b_c",
    "中__文__中",
    "中_文_中",
    "*中*文*",
    "**中**文**",
  );

  // R1: 32 个 ASCII 标点在 `\\` 之后，不同位置
  const asciiPunct = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split("");
  for (const p of asciiPunct) {
    const escape = `\\\\${p}`; // 源码形态：两个反斜杠 + 标点
    push(
      escape,
      `x${escape}`,
      `${escape}x`,
      `中${escape}中`,
      `*a*${escape}`,
      `a\n${escape}`,
      `# ${escape}`,
      `## a${escape}`,
      `- ${escape}`,
      `- a\n  ${escape}`,
      `> ${escape}`,
      `> a\n> ${escape}`,
      `| ${escape} | b |\n| --- | --- |\n| c | d |`,
      `[${escape}](u)`,
      `![${escape}](u)`,
      `**${escape}**`,
      `\`${escape}\``,
      `${escape}\n`,
      `a ${escape} b`,
    );
  }

  // R2: 引用块里的硬换行 / 反斜杠换行
  push(
    "> a  \n> b",
    "> a   \n> b",
    "> a\\\n> b",
    "> a\n> b",
    "> a \n> b",
    "> a  \n> b\n> c",
    "> > a  \n> > b",
    "> > a\\\n> > b",
    "> a  \n>\n> b",
    "> a  \n>\n> > b",
    "- > a  \n  > b",
    "> - a  \n>   b",
    "> `a`  \n> b",
    "> **a**  \n> b",
    "> 中  \n> 文",
    "> 中\\\n> 文",
    "> a  \n> 中",
    ">\n> a  \n> b",
    "> # a  \n> b",
  );

  // R3/W: 列表续行缩进
  push(
    "- a  \n  b",
    "- a\\\n  b",
    "- a  \n   b",
    "- a  \n    b",
    "- a\n  b",
    "- a\n   b",
    "1. a  \n   b",
    "* a  \n  b",
    "- 中  \n  文",
  );

  // W: 段落首尾空白 / 续行前导空白 / 行尾空白
  push(
    "a ",
    "a  ",
    "a   ",
    "a\t",
    "a \t ",
    " a\nb",
    "  a\nb",
    "   a\nb",
    "a\n b",
    "a\n  b",
    "a\n   b",
    "a\n\tb",
    "a\n \tb",
    "a \nb",
    "a  \nb",
    "a   \nb",
    "a\t\nb",
    "a \t\nb",
    "a  \n  b",
    "中 \n中",
    "\u4e2d\u0020\n\u6587",
    "a \n\nb",
    "a  \n\nb",
    "a  \n  \nb",
    "**a** \n**b**",
    "`a` \n`b`",
    "[a](x) \n[b](y)",
    "~~a~~  \n~~b~~",
    "# a ",
    "# a  ",
    "a  b",
    "a   b",
    "\n \na",
    " \na\n ",
    "a\u00a0\nb",
    "a\n\u00a0b",
    "a\n\u3000b",
    "a\u3000\nb",
  );

  // ── 9. CJK × 分隔符 run 长度矩阵（强调/删除线边界） ──────────────
  const runs = ["*", "**", "***", "_", "__", "___", "~~", "~~~~"];
  const contents = ["中", "中文", "abc", "中abc", "abc中", "中 文"];
  for (const open of runs) {
    for (const close of runs) {
      for (const body of contents) {
        push(`${open}${body}${close}`);
        push(`中${open}${body}${close}`);
        push(`${open}${body}${close}中`);
        push(`中${open}${body}${close}中`);
        push(`「${open}${body}${close}」`);
        push(`（${open}${body}${close}）。`);
      }
    }
  }

  // 转义 × 强调互扰
  push(
    "**\\***",
    "*\\***",
    "***\\**",
    "\\***中***",
    "***中\\***",
    "**中\\**",
    "\\**中**",
    "*a\\*b*",
    "**a\\*b**",
    "\\*a\\*",
    "~~a\\~~b~~",
    "~~\\~~a~~",
    "__a\\_b__",
    "_a\\_b_",
    "\\_a\\_",
    "**中\\*文**",
    "`\\`中`",
  );

  return [...new Set(cases)];
}
