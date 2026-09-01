/**
 * @file tuple-diff-parser.ts
 * @description 紧凑元组 JSON Diff 解析器、Unicode->UTF-16 坐标转换、三重防御定位及自适应定位算法。
 */

import type { CompactTupleDiff, ValidatedDiffItem } from "./types.ts";

/**
 * 将 Unicode Code Point 索引 (字符数) 换算为 JavaScript / CodeMirror 6 的 UTF-16 Code Unit 偏移量
 */
export function codePointOffsetToUtf16Offset(text: string, codePointIndex: number): number {
  if (codePointIndex <= 0) return 0;

  let codePointCount = 0;
  let utf16Offset = 0;

  for (const char of text) {
    if (codePointCount >= codePointIndex) {
      break;
    }
    utf16Offset += char.length; // 基础字符 +1, Emoji/代理对 +2
    codePointCount += 1;
  }

  return utf16Offset;
}

/**
 * 解析 LLM 返回的紧凑元组 JSON 输出
 * 支持 [[start, end, "original", "replacement"], ...] 格式
 * 若无错误或空输出则返回 []
 */
export function parseTupleDiffOutput(content: string): CompactTupleDiff[] {
  const trimmed = content.trim();
  if (!trimmed || trimmed === "<|endoftext|>" || trimmed === "[]") {
    return [];
  }

  // 提取 JSON 数组片段 (兼容可能存在的 markdown 围栏)
  const jsonString = extractJsonArrayString(trimmed);
  if (!jsonString) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonString) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const diffs: CompactTupleDiff[] = [];
    for (const item of parsed) {
      if (
        Array.isArray(item) &&
        item.length === 4 &&
        typeof item[0] === "number" &&
        typeof item[1] === "number" &&
        typeof item[2] === "string" &&
        typeof item[3] === "string" &&
        item[2] !== item[3]
      ) {
        diffs.push([item[0], item[1], item[2], item[3]]);
      }
    }

    return diffs;
  } catch {
    return [];
  }
}

/**
 * 提取文本中的 JSON Array 串
 */
function extractJsonArrayString(content: string): string | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return content.slice(start, end + 1);
  }
  return null;
}

/**
 * 三重防御定位校验算法：
 * 1. 坐标换算 (Code Points -> UTF-16)
 * 2. 强一致比对 (slice === original)
 * 3. ±fuzzyRadius 字符滑动窗口模糊纠偏 (Fuzzy Anchor)
 * 4. 无法匹配时静默丢弃
 */
export function resolveTripleDefenseDiffs(
  targetText: string,
  diffs: readonly CompactTupleDiff[],
  fuzzyRadius = 5,
): ValidatedDiffItem[] {
  const validated: ValidatedDiffItem[] = [];

  for (const [start, end, original, replacement] of diffs) {
    if (original === replacement) {
      continue;
    }
    const utf16From = codePointOffsetToUtf16Offset(targetText, start);
    const utf16To = codePointOffsetToUtf16Offset(targetText, end);

    // 1. 强一致匹配
    if (targetText.slice(utf16From, utf16To) === original) {
      validated.push({
        start,
        end,
        utf16From,
        utf16To,
        original,
        replacement,
        wasAdjusted: false,
      });
      continue;
    }

    // 纯插入场景 (original 为空，start === end)
    if (original === "" && utf16From === utf16To && utf16From <= targetText.length) {
      validated.push({
        start,
        end,
        utf16From,
        utf16To,
        original,
        replacement,
        wasAdjusted: false,
      });
      continue;
    }

    // 2. Fuzzy Anchor 模糊纠偏 (滑动窗口搜索)
    if (original !== "") {
      const searchStart = Math.max(0, utf16From - fuzzyRadius);
      const searchEnd = Math.min(targetText.length, utf16To + fuzzyRadius);
      const searchWindow = targetText.slice(searchStart, searchEnd);
      const indexInWindow = searchWindow.indexOf(original);

      if (indexInWindow !== -1) {
        const adjustedFrom = searchStart + indexInWindow;
        const adjustedTo = adjustedFrom + original.length;

        validated.push({
          start,
          end,
          utf16From: adjustedFrom,
          utf16To: adjustedTo,
          original,
          replacement,
          wasAdjusted: true,
        });
        continue;
      }
    }

    // 3. 匹配失败，静默丢弃该 Diff 片段 (绝不盲目切除)
  }

  return validated;
}

/**
 * 倒序应用一组已校验的 Diff (确保从后向前替换，不破坏前部偏移)
 */
export function applyTupleDiffs(
  targetText: string,
  validatedDiffs: readonly ValidatedDiffItem[],
): string {
  if (validatedDiffs.length === 0) {
    return targetText;
  }

  // 必须按 utf16From 降序排列 (从后往前替换)
  const sorted = validatedDiffs.toSorted((a, b) => b.utf16From - a.utf16From);
  let result = targetText;

  for (const diff of sorted) {
    result = result.slice(0, diff.utf16From) + diff.replacement + result.slice(diff.utf16To);
  }

  return result;
}

/**
 * 云端通用大模型 (OpenAI/Claude) 的三级自适应定位器 (Adaptive Locator)
 */
export function locateCloudEditSuggestion(
  targetText: string,
  edit: {
    readonly original: string;
    readonly replacement: string;
    readonly start?: number | null;
    readonly end?: number | null;
    readonly reason?: string;
  },
): ValidatedDiffItem | null {
  const original = edit.original;
  const replacement = edit.replacement;
  if (!original || original === replacement) {
    return null;
  }

  // 第 1 优先级：检查模型是否提供了 start/end 且校验通过
  if (
    typeof edit.start === "number" &&
    typeof edit.end === "number" &&
    edit.start >= 0 &&
    edit.end <= targetText.length &&
    targetText.slice(edit.start, edit.end) === original
  ) {
    return {
      start: edit.start,
      end: edit.end,
      utf16From: edit.start,
      utf16To: edit.end,
      original,
      replacement,
      wasAdjusted: false,
    };
  }

  // 第 2 优先级：查找 original 在文本中的所有出现位置
  const occurrences: number[] = [];
  let pos = targetText.indexOf(original);
  while (pos !== -1) {
    occurrences.push(pos);
    pos = targetText.indexOf(original, pos + 1);
  }

  if (occurrences.length === 0) {
    return null; // 无法在原文中找到该片段
  }

  if (occurrences.length === 1) {
    // 唯一出现，直接锁定
    const from = occurrences[0];
    const to = from + original.length;
    return {
      start: from,
      end: to,
      utf16From: from,
      utf16To: to,
      original,
      replacement,
      wasAdjusted: true,
    };
  }

  // 第 3 优先级：出现多次 (同词重复)，若有近似 start 则选取最近邻
  let bestFrom = occurrences[0];
  if (typeof edit.start === "number") {
    let minDistance = Math.abs(occurrences[0] - edit.start);
    for (let i = 1; i < occurrences.length; i++) {
      const dist = Math.abs(occurrences[i] - edit.start);
      if (dist < minDistance) {
        minDistance = dist;
        bestFrom = occurrences[i];
      }
    }
  }

  const bestTo = bestFrom + original.length;
  return {
    start: bestFrom,
    end: bestTo,
    utf16From: bestFrom,
    utf16To: bestTo,
    original,
    replacement,
    wasAdjusted: true,
  };
}
