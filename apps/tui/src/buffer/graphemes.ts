/**
 * grapheme 与显示列换算
 *
 * 为什么需要这一层：终端里 CJK/emoji 占 2 列，而 JS 字符串下标是 UTF-16 code unit。
 * 光标必须停在 grapheme 边界上，渲染与硬件光标定位必须用「显示列」。
 * 宽度语义直接复用 pi-tui 的 visibleWidth（内部 get-east-asian-width，即 wcwidth 语义）。
 */
import { visibleWidth } from "@earendil-works/pi-tui";

/** 共享的 grapheme 分段器（Intl.Segmenter 实例化有开销，进程内复用一份） */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 把一行文本切成 grapheme 数组 */
export function segmentGraphemes(text: string): string[] {
  if (text.length === 0) return [];
  const out: string[] = [];
  for (const part of segmenter.segment(text)) {
    out.push(part.segment);
  }
  return out;
}

/** grapheme 数量（组合字/emoji 序列算 1 个） */
export function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/** 第 index 个 grapheme 起点处的 code unit 偏移（越界夹到两端） */
export function graphemeToOffset(text: string, index: number): number {
  if (index <= 0) return 0;
  let seen = 0;
  let offset = 0;
  for (const part of segmenter.segment(text)) {
    if (seen === index) return offset;
    seen++;
    offset += part.segment.length;
  }
  return text.length;
}

/** code unit 偏移 → 所在 grapheme 下标（吸附到不越过的边界） */
export function offsetToGrapheme(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let seen = 0;
  let cursor = 0;
  for (const part of segmenter.segment(text)) {
    cursor += part.segment.length;
    if (cursor > offset) return seen;
    seen++;
    if (cursor === offset) return seen;
  }
  return seen;
}

/** 字符串终端显示宽度（列） */
export function displayWidth(text: string): number {
  return visibleWidth(text);
}

/** 光标停在 index 个 grapheme 之后时的显示列 */
export function displayColumnAt(text: string, graphemeIndex: number): number {
  return displayWidth(text.slice(0, graphemeToOffset(text, graphemeIndex)));
}

/**
 * 显示列 → grapheme 下标；列落进双宽字符内部时吸附到该字符起点，
 * 保证硬件光标永远不会停在宽字符的中间列。
 */
export function graphemeIndexAtDisplayColumn(text: string, column: number): number {
  if (column <= 0) return 0;
  let seen = 0;
  let col = 0;
  for (const part of segmenter.segment(text)) {
    const width = displayWidth(part.segment);
    if (col + width > column) return seen;
    col += width;
    seen++;
    if (col === column) return seen;
  }
  return seen;
}
