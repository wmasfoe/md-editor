import type { Locale } from "../lib/i18n/types";

export interface ShowcaseSample {
  readonly id: string;
  readonly filenameZh: string;
  readonly filenameZhHant: string;
  readonly filenameJa: string;
  readonly filenameEn: string;
  readonly titleZh: string;
  readonly titleZhHant: string;
  readonly titleJa: string;
  readonly titleEn: string;
  readonly icon: string;
  readonly markdownZh: string;
  readonly markdownZhHant: string;
  readonly markdownJa: string;
  readonly markdownEn: string;
}

export function getSampleFilename(sample: ShowcaseSample, locale: Locale): string {
  switch (locale) {
    case "zh":
      return sample.filenameZh;
    case "zh-Hant":
      return sample.filenameZhHant;
    case "ja":
      return sample.filenameJa;
    case "en":
    default:
      return sample.filenameEn;
  }
}

export function getSampleTitle(sample: ShowcaseSample, locale: Locale): string {
  switch (locale) {
    case "zh":
      return sample.titleZh;
    case "zh-Hant":
      return sample.titleZhHant;
    case "ja":
      return sample.titleJa;
    case "en":
    default:
      return sample.titleEn;
  }
}

export function getSampleMarkdown(sample: ShowcaseSample, locale: Locale): string {
  switch (locale) {
    case "zh":
      return sample.markdownZh;
    case "zh-Hant":
      return sample.markdownZhHant;
    case "ja":
      return sample.markdownJa;
    case "en":
    default:
      return sample.markdownEn;
  }
}

export const SHOWCASE_SAMPLES: readonly ShowcaseSample[] = Object.freeze([
  {
    id: "focus",
    filenameZh: "专注写作.md",
    filenameZhHant: "專注寫作.md",
    filenameJa: "集中執筆.md",
    filenameEn: "focus-writing.md",
    titleZh: "专注写作",
    titleZhHant: "專注寫作",
    titleJa: "集中執筆",
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
      "==试着点击此处，直接敲入你的文字，感受落笔生辉的质感...==",
    ].join("\n"),
    markdownZhHant: [
      "# 靜水流深，字字生香",
      "",
      "> 好的工具如水，潤物無聲，從不爭奪寫作者的注意力。",
      "",
      "寫作本是一場沉靜的對話。在喧囂的資訊洪流之外，總需要有一方沉靜的書桌。",
      "當手指敲下按鍵，文字隨墨跡在白紙上徐徐舒展；沒有繁雜的浮動視窗打擾，只有游標在呼吸。",
      "",
      "### 排版之美，隨手可得",
      "",
      "- **所見即所得**：雙星號與標記符號悄然隱退，一眼即成文章",
      "- **純文字之魂**：底層依然是純粹潔淨的 CommonMark / GFM 語法",
      "- **紙上呼吸感**：特別調校的行高與字距，讓長篇寫作不再疲勞",
      "",
      "==試著點擊此處，直接敲入你的文字，感受落筆生輝的質感...==",
    ].join("\n"),
    markdownJa: [
      "# 静けさの中に、言葉が息づく",
      "",
      "> 優れた道具は水のように、主張することなく書き手の思考を潤します。",
      "",
      "書くことは、静かな自己との対話です。情報の喧騒から離れ、心落ち着く書斎のような空間を。",
      "キーを打つたびに、和紙に墨が広がるように言葉が紡がれます。邪魔なポップアップはなく、カーソルだけが静かに呼吸しています。",
      "",
      "### 美しい組版を、思いのままに",
      "",
      "- **WYSIWYG**：記号は自然に隠れ、打った瞬間から美しい組版に",
      "- **プレーンテキストの精神**：基盤は純粋な CommonMark / GFM 記法",
      "- **紙のような心地よさ**：長文の執筆でも疲れにくい、繊細に調整された行間と文字間隔",
      "",
      "==ここをクリックして文字を入力し、思考が形になる心地よさを体感してください...==",
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
      "==Click anywhere here to type, edit, or craft your next thought...==",
    ].join("\n"),
  },
  {
    id: "craft",
    filenameZh: "纸墨相生.md",
    filenameZhHant: "紙墨相生.md",
    filenameJa: "紙と墨の調和.md",
    filenameEn: "paper-and-ink.md",
    titleZh: "纸墨相生",
    titleZhHant: "紙墨相生",
    titleJa: "紙と墨の調和",
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
    markdownZhHant: [
      "# 紙墨相生，心手相應",
      "",
      "> 筆墨本無言，落紙便成韻。",
      "",
      "從古樸的活字印刷到螢幕上的光影排版，文字的載體在變，但人對**典雅編排**的嚮往從未改變。",
      "",
      "```ts",
      "interface WritingCanvas {",
      "  readonly paper: 'stone-warm'; // 宣紙暖調底色",
      "  readonly ink: 'deep-charcoal'; // 純正墨色",
      "  readonly fidelity: 1.0;        // 原始碼無損保真",
      "}",
      "```",
      "",
      "每一處引用段落、每一行程式碼片段、每一個字斟句酌的標點，都在這方寸畫布之間自成節奏。",
    ].join("\n"),
    markdownJa: [
      "# 紙と墨の調和、手と心の共鳴",
      "",
      "> 言葉は紙の上に落ちて初めて、その調べを奏で始めます。",
      "",
      "活版印刷から現代のスクリーンタイポグラフィへと媒体が移り変わっても、**端正な組版**への敬意は変わりません。",
      "",
      "```ts",
      "interface WritingCanvas {",
      "  readonly paper: 'stone-warm'; // 和紙の温かみある地色",
      "  readonly ink: 'deep-charcoal'; // 深みのある純粋な墨色",
      "  readonly fidelity: 1.0;        // 100%忠実なソース復元性",
      "}",
      "```",
      "",
      "引用、コードブロック、吟味された言葉のすべてが、このキャンバスの上で心地よいリズムを生み出します。",
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

/** MDX 展区专用样例：WYSIWYG 与源码模式切换都落在同一篇文档上 */
export const MDX_SHOWCASE_SAMPLE: ShowcaseSample = Object.freeze({
  id: "architecture",
  filenameZh: "架构手记.mdx",
  filenameZhHant: "架構手記.mdx",
  filenameJa: "アーキテクチャノート.mdx",
  filenameEn: "architecture.mdx",
  titleZh: "架构手记",
  titleZhHant: "架構手記",
  titleJa: "アーキテクチャノート",
  titleEn: "Architecture Notes",
  icon: "⚡️",
  markdownZh: [
    "# 架构手记",
    "",
    "在同一篇 Markdown 里写入组件，不必离开书写流。",
    "",
    '<Callout type="info" title="本地优先">',
    "文档与组件都留在磁盘上，源码始终可还原，不必把思路交给云端。",
    "</Callout>",
    "",
    "标题、列表、引用与 MDX 组件共享同一画布。",
    "",
    "- **所见即所得**：组件以真实排版呈现",
    "- **源码保真**：切回源码时标签完整可还原",
  ].join("\n"),
  markdownZhHant: [
    "# 架構手記",
    "",
    "在同一篇 Markdown 裡寫入元件，不必離開書寫節奏。",
    "",
    '<Callout type="info" title="本機優先">',
    "文件與元件都保留在磁碟上，原始碼始終可還原，不必將思路託付給雲端。",
    "</Callout>",
    "",
    "標題、清單、引用與 MDX 元件共享同一個畫布。",
    "",
    "- **所見即所得**：元件以真實排版呈現",
    "- **原始碼保真**：切回原始碼時標籤完整可還原",
  ].join("\n"),
  markdownJa: [
    "# アーキテクチャノート",
    "",
    "執筆のフローを止めることなく、同じ Markdown 内にコンポーネントを記述。",
    "",
    '<Callout type="info" title="ローカルファースト">',
    "文書もコンポーネントもローカルディスク上に保存。クラウドに依存せず、いつでもソースコードを復元できます。",
    "</Callout>",
    "",
    "見出し、リスト、引用、MDX コンポーネントが 1 つのキャンバスを共有。",
    "",
    "- **WYSIWYG**：コンポーネントが実際のタイポグラフィとして表示",
    "- **ソースの忠実性**：ソースコードに切り替えてもタグ構造を完全保持",
  ].join("\n"),
  markdownEn: [
    "# Architecture Notes",
    "",
    "Write components in the same Markdown file — never leave the flow.",
    "",
    '<Callout type="info" title="Local-First">',
    "Documents and components stay on disk. Source is always recoverable.",
    "</Callout>",
    "",
    "Headings, lists, quotes, and MDX components share one canvas.",
    "",
    "- **WYSIWYG**: Components render as real typography",
    "- **Source fidelity**: Switch back and the tags remain intact",
  ].join("\n"),
});
