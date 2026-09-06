export interface ShowcaseSample {
  readonly id: string;
  readonly filenameZh: string;
  readonly filenameEn: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly icon: string;
  readonly markdownZh: string;
  readonly markdownEn: string;
}

export const SHOWCASE_SAMPLES: readonly ShowcaseSample[] = Object.freeze([
  {
    id: "focus",
    filenameZh: "专注写作.md",
    filenameEn: "focus-writing.md",
    titleZh: "专注写作",
    titleEn: "Focus Writing",
    icon: "📄",
    markdownZh: [
      "# 静水流深，字字生香",
      "",
      "> 好的工具如水，润物无声，从不争夺写作者的注意力。",
      "",
      "写作本是一场沉静的对话。在喧嚣的信息洪流之外，总需要有一方沉静的书桌。",
      "当手指敲下按键，文字随墨迹在白纸上徐徐舒展；没有繁杂的浮窗打扰，只有光标在呼吸。",
      "",
      "### 排版之美，随手可得",
      "",
      "- **所见即所得**：双星号与标记符号悄然隐退，一眼即成文章",
      "- **纯文本之魂**：底层依然是纯粹洁净的 CommonMark / GFM 语法",
      "- **纸上呼吸感**：特别调校的行高与字距，让长篇写作不再疲劳",
      "",
      "试着点击此处，直接敲入你的文字，感受落笔生辉的质感...",
    ].join("\n"),
    markdownEn: [
      "# The Art of Quiet Writing",
      "",
      "> The finest tools are like water — nourishing your thoughts without competing for attention.",
      "",
      "Writing is an intimate conversation with oneself. Beyond the endless digital chatter, you deserve a quiet sanctuary.",
      "As your fingers touch the keys, words flow effortlessly across the canvas. No cluttered floating menus, only the steady rhythm of your cursor.",
      "",
      "### Typography at Your Fingertips",
      "",
      "- **Seamless WYSIWYG**: Raw asterisks and markers softly recede into pure typography",
      "- **Pure Markdown Soul**: Underneath remains 100% faithful, standard CommonMark / GFM",
      "- **Generous Breath**: Thoughtfully tuned line heights and margins for effortless long-form essays",
      "",
      "Click anywhere here to type, edit, or craft your next thought...",
    ].join("\n"),
  },
  {
    id: "craft",
    filenameZh: "纸墨相生.md",
    filenameEn: "paper-and-ink.md",
    titleZh: "纸墨相生",
    titleEn: "Paper & Ink",
    icon: "✒️",
    markdownZh: [
      "# 纸墨相生，心手相应",
      "",
      "> 笔墨本无言，落纸便成韵。",
      "",
      "从古朴的活字印刷到屏幕上的光影排版，文字的载体在变，但人对**典雅编排**的向往从未改变。",
      "",
      "```ts",
      "interface WritingCanvas {",
      "  readonly paper: 'stone-warm'; // 宣纸暖调底色",
      "  readonly ink: 'deep-charcoal'; // 纯正墨色",
      "  readonly fidelity: 1.0;        // 源码无损保真",
      "}",
      "```",
      "",
      "每一处引用段落、每一行代码片段、每一个字斟句酌的标点，都在这方寸画布之间自成节奏。",
    ].join("\n"),
    markdownEn: [
      "# Harmony of Ink and Canvas",
      "",
      "> Words hold no voice until written; upon the page, they find their cadence.",
      "",
      "From traditional movable type to modern digital typography, medium evolves, but our reverence for **typographic elegance** endures.",
      "",
      "```ts",
      "interface WritingCanvas {",
      "  readonly paper: 'stone-warm'; // Warm paper undertone",
      "  readonly ink: 'deep-charcoal'; // Deep rich charcoal text",
      "  readonly fidelity: 1.0;        // 100% lossless source",
      "}",
      "```",
      "",
      "Every blockquote, every code block, and every carefully weighed word breathes with balanced visual rhythm.",
    ].join("\n"),
  },
]);
