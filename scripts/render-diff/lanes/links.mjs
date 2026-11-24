/**
 * @file links.mjs
 * @description 渲染差分固定语料：脚注 / 引用定义 / 链接 / 图片 / autolink / 危险协议。
 *
 * 为什么需要它：链接族是「定义行与使用行分离」的语法，两侧实现的差异几乎全部
 * 出现在**跨块相互作用**上——定义行出现在引用块/列表/缩进代码里、定义行后跟
 * 非引号 title、重复 label、脚注引用嵌在内联链接文本中、危险协议过滤时机不同。
 * 这类形态无法靠单点 fixture 覆盖，只能靠「使用行 × 定义行」的笛卡尔积枚举。
 * 历史上该 lane 一次性暴露了定义行尾换行归属、相邻定义行被合并、重复 label
 * 只保留首条等数十例未登记分歧。
 *
 * 语料来自 8 路并行探针的 L2 lane（原 `/tmp/l2-corpus.mjs`），只保留用例生成部分。
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
 * 生成 L2 全量语料。
 *
 * @returns {string[]}
 */
export function buildCases() {
  const cases = [];
  const add = (markdown) => cases.push(markdown);
  const addAll = (list) => list.forEach(add);

  // ---------------------------------------------------------------- 脚注
  const fnRefs = [
    "正文[^1] 后续。",
    "正文[^a] 后续。",
    "正文[^] 后续。",
    "正文[^1][] 后续。",
    "正文[^1] 与 [^1] 重复。",
    "正文[^1] 与 [^2] 两个。",
    "正文[^*x*] 星号标签。",
    "正文[^中文] 中文标签。",
    "正文[^a b] 空格标签。",
    "正文[^A] 大写标签。",
    "[^1]",
    "[^1][]",
    "[^]",
    "行首[^1]，行中[^1]，行尾[^1]",
    "[链接[^1]](u)",
    "**加粗[^1]** 后",
    "`code[^1]` 后",
    "- 列表项[^1]\n- 第二项[^2]",
    "> 引用[^1]",
    "# 标题[^1]",
  ];
  const fnDefs = [
    "[^1]: /u",
    "[^1]: 内容含空格",
    "[^1]: https://example.com/a",
    "[^1]: 中文内容说明",
    "[^A]: /u",
    "[^a]: /u",
    "[^]: /u",
    "[^1]: /u\n[^1]: /v",
    '[^1]: /u "title"',
    "[^1]: <https://a.b/c d>",
    "[^1]: /u\n    续行内容",
    "[^1]:",
    "[^1]: ",
    "   [^1]: /u",
    "> [^1]: /u",
    "- [^1]: /u",
    "1. [^1]: /u",
    "[^1]: /u\n\n正文之后",
  ];
  // 引用在前 + 定义在后 / 定义在前 + 引用在后
  addAll(fnRefs);
  addAll(fnDefs);
  for (const ref of fnRefs) addAll(product([ref], fnDefs));
  for (const ref of fnRefs) addAll(product(fnDefs, [ref]));

  // 脚注 + 引用式链接混排
  addAll([
    "[a][b]\n\n[^1]: /u\n\n[b]: /v",
    "[^1]: /u\n\n[a][b]\n\n[b]: /v",
    "[^1] and [a][b]\n\n[^1]: /u\n\n[b]: /v",
    "[^1]: /u\n[b]: /v\n\n[^1] [a][b]",
  ]);

  // ---------------------------------------------------------------- 引用式链接
  const refLinkUses = [
    "[a][b]",
    "[a][]",
    "[a]",
    "[Foo][]",
    "[foo][]",
    "[A][B]",
    "[a][b] 与 [c][b]",
    "[a][b] 与 [a][b]",
    "*[a][b]*",
    "**[a][b]**",
    "`[a][b]`",
    "![a][b]",
    "![](b)",
    "[][b]",
    "[a][b c]",
    "[a][中文]",
    "[a][b] 与 [a][B]",
    "[a] [b]",
    "[a]\n[b]",
    "[a][b][]",
    "[[a]][b]",
    "[a][b]\n\n[c][b]",
    "1. [a][b]\n2. [c][b]",
    "> [a][b]",
    "# [a][b]",
  ];
  const refDefs = [
    "[b]: /u",
    '[b]: /u "t"',
    "[b]: /u 't'",
    "[b]: /u (t)",
    "[b]: <u>",
    "[b]: <u v>",
    "[b]: /u\n[b]: /v",
    "[b]: /u\n[B]: /v",
    "[B]: /u",
    '[b]: /u\n   "multi line title"',
    '[b]: /u ""',
    "[b]:/u",
    "[b]:    /u",
    "   [b]: /u",
    "    [b]: /u",
    "> [b]: /u",
    "- [b]: /u",
    "[b]: /u 额外文字",
    "[b]: /u v",
    "[b]: javascript:x",
    "[b]: https://a.b/c?d=1&e=2",
    "[b]: /u\n\n正文",
    "[b]:\n/u",
  ];
  addAll(refLinkUses);
  addAll(refDefs);
  for (const use of refLinkUses) addAll(product([use], refDefs));
  for (const use of refLinkUses.slice(0, 8)) addAll(product(refDefs, [use]));

  // 定义在块容器中
  addAll([
    "> [b]: /u\n\n[a][b]",
    "- [b]: /u\n\n[a][b]",
    "1. [b]: /u\n\n[a][b]",
    "> [a][b]\n>\n> [b]: /u",
    "- [a][b]\n\n  [b]: /u",
    "````\n[b]: /u\n````\n\n[a][b]",
    "    [b]: /u\n\n[a][b]",
    "<div>\n[b]: /u\n</div>\n\n[a][b]",
  ]);

  // ---------------------------------------------------------------- 内联链接
  addAll([
    "[a](u)",
    '[a](u "t")',
    "[a](u 't')",
    "[a](u (t))",
    "[a](<u v>)",
    "[a](<u>)",
    "[a]()",
    "[](u)",
    '[](/u "t")',
    "[a](u v)",
    "[a](u(()))",
    "[a](u\\(x\\))",
    "[a](http://a.b/(x))",
    "[a](u?x=1&y=2)",
    "[a](u#frag)",
    "[a](中文/路径)",
    "[a](%E4%B8%AD)",
    "[a](ur l)",
    "[a]( u )",
    "[a](\nu\n)",
    "[a](u\n)",
    "[a]\n(u)",
    "[a] (u)",
    "[a](u)b",
    "[a](**b**)",
    "[**a**](u)",
    "[`a`](u)",
    '[a](u "t \\" q")',
    '[a](u "t\nline")',
    '[a](u\t"t")',
    "[a<b>](u)",
    "[a\nb](u)",
    "[[a]](u)",
    "[a](u)[b](v)",
    '[a](u "")',
    "[a](.)",
    "[a](#)",
    "[a](//a.b)",
    "[a](/u/)",
    "[a](u&v;w)",
    "[a](<u>)x",
    "[![i](p)](u)",
    "[a](u){:target=_blank}",
  ]);

  // ---------------------------------------------------------------- 图片
  addAll([
    "![a](p)",
    "![](p)",
    "![a]()",
    '![a](p "t")',
    "![a][b]\n\n[b]: /p",
    "![a][]\n\n[a]: /p",
    "![a][b][]\n\n[b]: /p",
    "![**b**](p)",
    "![`b`](p)",
    "![*b*](p)",
    "![](p)",
    "![a](<p q>)",
    "![a](中文.png)",
    "![a](p?x=1&y=2)",
    "![a](p) 后",
    "前 ![a](p) 后",
    "![a\nb](p)",
    "[![a](p)](u)",
    "![a](p)[b](u)",
    "> ![a](p)",
    "- ![a](p)",
    "![a](p)\n\n![b](q)",
    "![a [b]](p)",
    "![a](p",
    "![[a]](p)",
    '![](p "")',
    "![a](javascript:x)",
    "![a](data:image/png;base64,AAA)",
    '![a](p.jpg "ti tle")',
    "![][b]\n\n[b]: /p",
    "![](<p>)",
  ]);

  // ---------------------------------------------------------------- autolink
  addAll([
    "<https://a.b>",
    "<http://a.b/c?d=1>",
    "<a@b.com>",
    "<mailto:a@b.com>",
    "https://a.b",
    "http://a.b",
    "a@b.com",
    "www.a.com",
    "www.a.com/path",
    "前 https://a.b 后",
    "前 www.a.b 后",
    "(https://a.b)",
    "[https://a.b]",
    "<https://a.b/c d>",
    "<ftp://a.b>",
    "<https://中文.cn>",
    "https://a.b/path_with_underscores_end_",
    "https://a.b/x" + "y".repeat(60),
    "see https://a.b, then",
    "https://a.b.",
    "**https://a.b**",
    "`https://a.b`",
    "[https://a.b](https://c.d)",
    "<not a link>",
    "<a@b>",
    "<@b.com>",
    "https://a.b?q=1&r=2",
    "https://a.b#frag",
    "WWW.a.com",
    "www.a",
    "http://",
    "https://",
    "mailto:a@b.com",
    "xmpp:a@b.com",
    "<xmpp:a@b.com>",
  ]);

  // ---------------------------------------------------------------- 危险协议
  addAll([
    "[a](javascript:alert(1))",
    "[a](vbscript:x)",
    "[a](javascript:void(0))",
    "[a](JaVaScRiPt:x)",
    "[a](data:text/html,<script>x</script>)",
    "[a](file:///etc/passwd)",
    "![a](javascript:alert(1))",
    "![a](vbscript:x)",
    "[a]: javascript:x",
    "[b][]\n\n[b]: javascript:x",
    "[b]\n\n[b]: vbscript:x",
    "[a](javascript&#58;x)",
    "[a](javascript\\:x)",
    "[a]( javascript:x )",
    "[a](<javascript:x>)",
    "<javascript:alert(1)>",
    "[a](jAvAsCrIpT:alert(1))",
    "[a](data:image/svg+xml;base64,AA)",
    "[a](vbscript:msgbox)",
  ]);

  // ---------------------------------------------------------------- 交叉：链接 + 其他块
  addAll([
    "# [a](u)",
    "> [a](u)",
    "- [a](u)",
    "1. [a](u)",
    "| [a](u) | b |\n| --- | --- |\n| c | d |",
    "**a [b](u) c**",
    "a[^1]\n\n[^1]: /u\n\n[b](v)",
    "- [a][b]\n- [c][b]\n\n[b]: /u",
    "> [a][b]\n\n[b]: /u",
    "```\n[a](u)\n```\n\n[b](v)",
    "`[a](u)` 与 [b](v)",
    "[a](u) 与 `[b](v)`",
    "<div>[a](u)</div>",
    "a  \nb [c](u)",
    "* * *\n\n[a](u)",
  ]);

  // ---------------------------------------------------------------- 第二波补测（邻近形态）
  addAll([
    "[]: /u",
    "[]: /u\n\n[a][]",
    "[a]:",
    "[a]: ",
    "[a]: <>",
    "[a]: <u>\n\n[a]",
    "[a]: <u v>",
    "[a]: /u\n[a]: /v",
    "[a]: /u\n[A]: /u",
    "[a b]: /u\n\n[a b]",
    "[a  b]: /u",
    "[a]: /u\n[b]: /v\n\n[a] [b]",
    '[a]: /u "t"\n[b]: /v\n\n[a][b]',
    "[a]: /u\n\n[b]: /v\n\n[a] [b]",
    "正文\n\n[a]: /u",
    "正文[a]: /u",
    "x [a]: /u",
    "[a](u)\n[b]: /v",
    "[a]\n\n[a]: /u",
    '[^1]: /u "t"',
    '[^1]: "t"',
    "[^1]: <u>",
    "[^1]: u\n[^2]: v\n\n[^1] [^2]",
    "text[^1]\n\n[^1]: /u\n\nafter",
    "text[^1]\n\n[^1]: /u\n[b]: /v",
    "| [a][b] |\n| --- |\n| [c][b] |\n\n[b]: /u",
    "![a](p)\n![b][c]\n\n[c]: /q",
    "> ![a](p)",
    "- [ ] [a](u)",
    "[a](javascript:alert(1))",
    "![a](https://a.b/c d)",
    "<https://a.b>\nhttps://c.d",
    "www.a.com/path?x=1",
    "a@b.com 与 www.a.com",
  ]);

  return [...new Set(cases)];
}
