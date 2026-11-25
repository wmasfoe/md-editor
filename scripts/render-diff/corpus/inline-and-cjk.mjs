/**
 * @file inline-and-cjk.mjs
 * @description 行内语法与 CJK 邻接边界的差分语料。
 *
 * 守护契约（对应 packages/compiler/tests/cjk-emphasis.test.ts 与 render-html.test.ts 的行内部分）：
 * - CJK 友好强调：中文标点紧贴的 `**加粗**` 不退化为字面文本；
 * - 不产生「**到**」这类跨对错配；
 * - 标记/内容类名契约：外层 `<span class="cm-md-marker cm-md-marker--bold">**</span>`，
 *   内容 `<strong class="cm-md-inline cm-md-bold">…</strong>`；
 * - `_` / `__` 保留 CommonMark 词内限制（与编辑器语法树口径一致），
 *   因此这部分**只能按语义比较**——comrak 的 cjk_friendly_emphasis 与
 *   marked-cjk-friendly 是两套独立实现。
 *
 * 比较模式说明：
 * - `semantic`：CJK 强调边界（允许标签结构等价而非字节一致）
 * - `byte`：其余行内语法（输出完全由我们控制，必须逐字节一致）
 */

export const INLINE_AND_CJK_FIXTURES = [
  // ---------------------------------------------------------------------------
  // CJK 强调边界 —— semantic
  // ---------------------------------------------------------------------------
  {
    id: "cjk-bold-punctuation-adjacent",
    mode: "semantic",
    guards: "cjk-emphasis: 中文标点紧贴加粗不退化为字面文本",
    markdown:
      "本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定、分镜生成、视频配音、剪辑成片」**的完整落地路径",
  },
  {
    id: "cjk-bold-no-cross-pairing",
    mode: "semantic",
    guards: "cjk-emphasis: 不产生「**到**」这类跨对错配",
    markdown: "从**「爆款」**到**「角色锁定」**的路径",
  },
  {
    id: "cjk-bold-boundary-forms",
    mode: "semantic",
    guards: "cjk-emphasis: 句首/句末/全角括号/日文/韩文边界",
    markdown: [
      "**测试。**测试",
      "测试**（测试）**测试",
      "**この文は重要です。**但这句话并不重要。",
      "これは**私のやりたかったこと。**だからするの。",
      "**これは韓国語です。**これは重要です。",
    ].join("\n\n"),
  },
  {
    id: "cjk-bold-start-and-end-of-line",
    mode: "semantic",
    guards: "cjk-emphasis: 句首与句末的加粗",
    markdown: ["**句首加粗**后面是正文", "前面是正文**句末加粗**"].join("\n\n"),
  },
  {
    id: "cjk-strikethrough-adjacent",
    mode: "semantic",
    guards: "cjk-emphasis: GFM 删除线的 CJK 邻接场景",
    markdown: "这是~~已废弃的说明。~~这是仍然有效的内容。",
  },
  {
    id: "cjk-italic-and-bold-share-rules",
    mode: "semantic",
    guards: "cjk-emphasis: 行内强调/删除线/斜体共用同一套 CJK 判定",
    markdown: ["*斜体。*正文", "**加粗。**正文", "~~删除。~~正文"].join("\n\n"),
  },
  {
    id: "cjk-underscore-keeps-commonmark-word-limit",
    mode: "semantic",
    guards: "cjk-emphasis: `_` 保留 CommonMark 词内限制",
    markdown: ["snake_case_should_not_italicize", "这是 _斜体_ 测试", "__双下划线__ 在词首"].join(
      "\n\n",
    ),
  },
  {
    id: "non-cjk-emphasis-unchanged",
    mode: "byte",
    guards: "cjk-emphasis: 非 CJK 文本保持 CommonMark 原语义",
    markdown: ["This is **bold** and *italic* and ~~deleted~~.", "Plain text."].join("\n\n"),
  },

  // ---------------------------------------------------------------------------
  // 常规行内语法 —— byte
  // ---------------------------------------------------------------------------
  {
    id: "inline-codespan",
    mode: "byte",
    guards: "render-html: 行内代码与反引号边界",
    markdown: [
      "行内 `code` 与 ```双反引号 `code` ``` 混排。",
      "整行只有 `const x = 1;` 的行内代码。",
    ].join("\n\n"),
  },
  {
    id: "inline-links-and-images",
    mode: "byte",
    guards: "render-html: 链接与图片（含 title、尖括号路径、相对路径）",
    markdown: [
      "[普通链接](https://example.com)",
      '[带 title](https://example.com "标题")',
      "[相对链接](./docs/readme.md)",
      "[锚点链接](#section)",
      "![图片](./assets/pic.png)",
      '![带 title](./assets/pic.png "alt title")',
      "![尖括号路径](<./assets/with space.png>)",
    ].join("\n\n"),
  },
  {
    id: "inline-autolink-and-bare-url",
    mode: "byte",
    guards: "render-html: GFM autolink",
    markdown: ["<https://example.com>", "https://example.com/bare"].join("\n\n"),
  },
  {
    id: "inline-hardbreak-and-softbreak",
    mode: "byte",
    guards: "render-html: 硬换行（两个空格 / 反斜杠）与软换行",
    markdown: [
      "第一行行尾两个空格  ",
      "第二行",
      "",
      "第三行反斜杠\\",
      "第四行",
      "",
      "第五行软换行",
      "第六行",
    ].join("\n"),
  },
  {
    id: "inline-escape-characters",
    mode: "byte",
    guards: "render-html: 反斜杠转义",
    markdown: "转义：\\*not italic\\*、\\$not math\\$、\\`not code\\`、\\# not heading",
  },
  {
    id: "inline-html-inline-tag",
    mode: "byte",
    guards: "render-html: 行内 HTML 标签保留",
    markdown: "行内 <kbd>Ctrl</kbd> 与 <br/> 标签。",
  },
  {
    id: "inline-text-escaping",
    mode: "byte",
    guards: "render-html: 文本节点的 HTML 实体转义",
    markdown: "特殊字符：< > & \" ' 全部需要转义。",
  },
];
