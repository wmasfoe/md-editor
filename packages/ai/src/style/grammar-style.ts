/**
 * @file style/grammar-style.ts
 * @module @md-editor/ai/style
 * @description
 * 语法与润色修复中的写作偏好：确定性的误报过滤与风格统一建议。
 *
 * - 误报过滤：模型给出的修改如果只是把用户习惯的写法改成另一种（术语译成中文、
 *   增删中英文空格、全半角标点互换），就丢弃，避免把个人习惯判成错误；
 * - 风格建议：按机械维度（中英文空格、标点宽度）找出与偏好不一致的地方，
 *   作为 `kind: "style"` 的建议，与模型给出的 `kind: "fix"` 修正分开展示。
 *
 * 只处理规则明确的机械维度，不按“语气”“组织方式”等主观偏好改写句子。
 * 首版只需要两条机械规则，没有引入 autocorrect（wasm 包约 3MB）。
 */

import type { ValidatedDiffItem } from "../domain/types.ts";
import { mergedStyleValue } from "./merge.ts";
import type { MergedStyleProfile } from "./types.ts";

const CJK = String.raw`\p{Script=Han}`;
const HAS_CJK = new RegExp(CJK, "u");
const HAS_LATIN_WORD = /[A-Za-z]{2,}/u;
const HALF_TO_FULL: Readonly<Record<string, string>> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
};
const FULL_TO_HALF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(HALF_TO_FULL).map(([half, full]) => [full, half]),
);

/** 带种类的修改项；`fix` 来自模型纠错，`style` 来自写作偏好 */
export type StyledDiffItem = ValidatedDiffItem & { readonly kind: "fix" | "style" };

/** 去掉空格后两段文字是否相同（说明修改只增删了空格） */
function sameIgnoringSpaces(a: string, b: string): boolean {
  return a !== b && a.replace(/ /gu, "") === b.replace(/ /gu, "");
}

/** 两段文字是否只在全半角标点上不同；返回修改方向 */
function punctuationWidthChange(a: string, b: string): "to-half" | "to-full" | null {
  if (a.length !== b.length || a === b) return null;
  let direction: "to-half" | "to-full" | null = null;
  for (let index = 0; index < a.length; index += 1) {
    const from = a[index]!;
    const to = b[index]!;
    if (from === to) continue;
    const step =
      HALF_TO_FULL[from] === to ? "to-full" : FULL_TO_HALF[from] === to ? "to-half" : null;
    if (!step || (direction && direction !== step)) return null;
    direction = step;
  }
  return direction;
}

/** 修改是否与画像中的书写习惯冲突（应作为误报丢弃） */
export function conflictsWithStyle(
  diff: Pick<ValidatedDiffItem, "original" | "replacement">,
  profile: MergedStyleProfile | undefined,
): boolean {
  if (!profile) return false;
  const { original, replacement } = diff;

  // 术语保留英文：原文有英文单词，修改后英文消失且换成了中文。
  if (
    mergedStyleValue(profile, "termScript") === "keep-english" &&
    HAS_LATIN_WORD.test(original) &&
    !HAS_LATIN_WORD.test(replacement) &&
    HAS_CJK.test(replacement)
  ) {
    return true;
  }

  const spacing = mergedStyleValue(profile, "cjkLatinSpacing");
  if (spacing && sameIgnoringSpaces(original, replacement)) {
    const removesSpaces = replacement.length < original.length;
    if ((spacing === "spaced" && removesSpaces) || (spacing === "unspaced" && !removesSpaces)) {
      return true;
    }
  }

  const width = mergedStyleValue(profile, "cjkPunctuationWidth");
  const change = width ? punctuationWidthChange(original, replacement) : null;
  if (
    (width === "fullwidth" && change === "to-half") ||
    (width === "halfwidth" && change === "to-full")
  ) {
    return true;
  }
  return false;
}

/** 把一个区间对应的修改项转换成带坐标的建议 */
function styleDiff(
  start: number,
  end: number,
  original: string,
  replacement: string,
): StyledDiffItem {
  return {
    start,
    end,
    utf16From: start,
    utf16To: end,
    original,
    replacement,
    kind: "style",
  };
}

/** 行内代码、链接地址与自动链接中的文字不做风格修改 */
function protectedRanges(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  // URL 在空白、中文或右括号处结束，避免把后面的正文也当成链接。
  const url = new RegExp(String.raw`https?:\/\/[^\s)\]>${"\\p{Script=Han}"}]+`, "gu");
  for (const pattern of [/`[^`\n]*`/gu, /\]\([^)\n]*\)/gu, url, /<[^>\n]+>/gu]) {
    for (const match of text.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function isProtected(ranges: ReadonlyArray<readonly [number, number]>, from: number, to: number) {
  return ranges.some(([start, end]) => from < end && to > start);
}

/**
 * 按画像的机械维度生成风格统一建议。坐标以 `text` 首字符为 0 的 UTF-16 偏移。
 */
export function buildStyleSuggestions(
  text: string,
  profile: MergedStyleProfile | undefined,
): StyledDiffItem[] {
  if (!profile) return [];
  const ranges = protectedRanges(text);
  const suggestions: StyledDiffItem[] = [];
  const spacing = mergedStyleValue(profile, "cjkLatinSpacing");

  if (spacing === "spaced") {
    const boundary = new RegExp(`(${CJK})([A-Za-z0-9])|([A-Za-z0-9])(${CJK})`, "gu");
    for (const match of text.matchAll(boundary)) {
      const from = match.index;
      const to = from + match[0].length;
      if (isProtected(ranges, from, to)) continue;
      const [left, right] = match[1] ? [match[1], match[2]!] : [match[3]!, match[4]!];
      suggestions.push(styleDiff(from, to, match[0], `${left} ${right}`));
    }
  } else if (spacing === "unspaced") {
    const boundary = new RegExp(`(${CJK}) ([A-Za-z0-9])|([A-Za-z0-9]) (${CJK})`, "gu");
    for (const match of text.matchAll(boundary)) {
      const from = match.index;
      const to = from + match[0].length;
      if (isProtected(ranges, from, to)) continue;
      suggestions.push(styleDiff(from, to, match[0], match[0].replace(" ", "")));
    }
  }

  const width = mergedStyleValue(profile, "cjkPunctuationWidth");
  if (width === "fullwidth" || width === "halfwidth") {
    const map = width === "fullwidth" ? HALF_TO_FULL : FULL_TO_HALF;
    // u 模式下字符类内只能转义语法字符，这里只有 `.`、`?` 需要处理。
    const chars = Object.keys(map)
      .map((char) => (char === "." || char === "?" ? `\\${char}` : char))
      .join("");
    // 只改紧跟在中文后面、且不是小数点或省略号一部分的标点。
    const pattern = new RegExp(`(?<=${CJK})([${chars}])(?![0-9.。])`, "gu");
    for (const match of text.matchAll(pattern)) {
      const from = match.index;
      const to = from + 1;
      if (isProtected(ranges, from, to)) continue;
      suggestions.push(styleDiff(from, to, match[0], map[match[0]]!));
    }
  }

  return suggestions.toSorted((a, b) => a.start - b.start);
}

/**
 * 合并模型修正与风格建议：先丢弃与习惯冲突的修正，再加入不与修正重叠的风格建议。
 */
export function applyStyleToGrammarDiffs(
  text: string,
  fixes: readonly ValidatedDiffItem[],
  profile: MergedStyleProfile | undefined,
): StyledDiffItem[] {
  const kept: StyledDiffItem[] = fixes
    .filter((diff) => !conflictsWithStyle(diff, profile))
    .map((diff) => ({ ...diff, kind: "fix" as const }));
  const styles = buildStyleSuggestions(text, profile).filter(
    (style) => !kept.some((fix) => style.start < fix.end && style.end > fix.start),
  );
  return [...kept, ...styles].toSorted((a, b) => a.start - b.start);
}
