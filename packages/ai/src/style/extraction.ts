/**
 * @file style/extraction.ts
 * @module @md-editor/ai/style
 * @description
 * 从 Markdown 中抽取可用于风格学习的“用户散文”。
 *
 * 排除：frontmatter、代码块与行内代码、引用块、HTML、表格、分割线，以及用户采纳过的 AI 句子。
 * 保留：正文段落与列表项文字；标题只计数，不参与句子统计。
 */

import { lexer, type Token, type Tokens } from "marked";

import { hashStyleText, normalizeStyleText } from "./hash.ts";

/** 散文少于该字符数的文件不作为样本 */
export const MIN_SAMPLE_PROSE_CHARS = 200;
/** 参与身份校验的段落最短长度，过短的段落（如“谢谢”）太常见 */
const MIN_IDENTITY_PARAGRAPH_CHARS = 20;
/** 每个样本最多保留的段落 hash 数 */
export const MAX_PARAGRAPH_HASHES = 200;

const FRONTMATTER_PATTERN = /^(?:---|\+\+\+)\r?\n[\s\S]*?\r?\n(?:---|\+\+\+)[ \t]*(?:\r?\n|$)/u;

export interface ExtractedProse {
  /** 正文段落（已去掉 AI 句子） */
  readonly paragraphs: readonly string[];
  /** 列表项文字（已去掉 AI 句子） */
  readonly listItems: readonly string[];
  /** 正文段落与列表项中的句子 */
  readonly sentences: readonly string[];
  readonly headingCount: number;
  /** 加粗与斜体的出现次数 */
  readonly emphasisCount: number;
  /** 段落与列表项的总字符数 */
  readonly proseChars: number;
  /** 段落归一化 hash，用于目录身份校验 */
  readonly paragraphHashes: readonly string[];
  /** 散文是否足够作为样本 */
  readonly eligible: boolean;
}

export interface ExtractProseOptions {
  /** 用户采纳过的 AI 句子 hash，这些句子不参与学习 */
  readonly aiSentenceHashes?: ReadonlySet<string>;
}

const sentenceSegmenter = new Intl.Segmenter("zh", { granularity: "sentence" });

/** 按句切分，去掉空句 */
export function splitStyleSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const { segment } of sentenceSegmenter.segment(text)) {
    const sentence = segment.trim();
    if (sentence) {
      sentences.push(sentence);
    }
  }
  return sentences;
}

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_PATTERN, "");
}

export function extractStyleProse(
  markdown: string,
  options: ExtractProseOptions = {},
): ExtractedProse {
  const aiHashes = options.aiSentenceHashes;
  const tokens = lexer(stripFrontmatter(markdown));
  const paragraphs: string[] = [];
  const listItems: string[] = [];
  const sentences: string[] = [];
  const paragraphHashes: string[] = [];
  let headingCount = 0;
  let emphasisCount = 0;

  /** 去掉 AI 句子，返回剩余句子 */
  const keepUserSentences = (text: string): string[] =>
    splitStyleSentences(text).filter((sentence) => !aiHashes?.has(hashStyleText(sentence)));

  for (const token of tokens) {
    if (token.type === "heading") {
      headingCount += 1;
      continue;
    }
    if (token.type === "paragraph") {
      const paragraph = token as Tokens.Paragraph;
      emphasisCount += countEmphasis(paragraph.tokens);
      const kept = keepUserSentences(inlineText(paragraph.tokens));
      if (kept.length === 0) {
        continue;
      }
      const text = kept.join("");
      paragraphs.push(text);
      sentences.push(...kept);
      if (
        text.length >= MIN_IDENTITY_PARAGRAPH_CHARS &&
        paragraphHashes.length < MAX_PARAGRAPH_HASHES
      ) {
        paragraphHashes.push(hashStyleText(text));
      }
      continue;
    }
    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) {
        const itemTokens = item.tokens.flatMap((child) =>
          child.type === "text" || child.type === "paragraph"
            ? ((child as Tokens.Text | Tokens.Paragraph).tokens ?? [child])
            : [],
        );
        emphasisCount += countEmphasis(itemTokens);
        const kept = keepUserSentences(inlineText(itemTokens));
        if (kept.length > 0) {
          listItems.push(kept.join(""));
          sentences.push(...kept);
        }
      }
    }
    // 代码、引用、HTML、表格、分割线等不属于用户散文。
  }

  const proseChars = [...paragraphs, ...listItems].reduce(
    (total, text) => total + normalizeStyleText(text).length,
    0,
  );
  return {
    paragraphs,
    listItems,
    sentences,
    headingCount,
    emphasisCount,
    proseChars,
    paragraphHashes,
    eligible: proseChars >= MIN_SAMPLE_PROSE_CHARS,
  };
}

/** 把行内 token 还原为纯文字；行内代码、图片与内联 HTML 不计入散文 */
function inlineText(tokens: readonly Token[] | undefined): string {
  if (!tokens) {
    return "";
  }
  let text = "";
  for (const token of tokens) {
    switch (token.type) {
      case "codespan":
      case "image":
      case "html":
        break;
      case "br":
        text += "\n";
        break;
      case "text":
      case "escape": {
        const inline = token as Tokens.Text;
        text += inline.tokens ? inlineText(inline.tokens) : inline.text;
        break;
      }
      default: {
        const nested = (token as { tokens?: Token[] }).tokens;
        text += nested ? inlineText(nested) : ((token as { text?: string }).text ?? "");
      }
    }
  }
  return text;
}

function countEmphasis(tokens: readonly Token[] | undefined): number {
  if (!tokens) {
    return 0;
  }
  let count = 0;
  for (const token of tokens) {
    if (token.type === "strong" || token.type === "em") {
      count += 1;
    }
    count += countEmphasis((token as { tokens?: Token[] }).tokens);
  }
  return count;
}
