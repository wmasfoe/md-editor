/**
 * @file grammar-suggestion-items.ts
 * @description
 * 把语法与润色修复的结果转换成编辑器建议项（文档绝对坐标）。
 *
 * 每个修改都成为一个建议项，`kind` 区分错误修正与写作偏好带来的风格建议，
 * 编辑器据此显示“修正 / 风格”标记，用户可以逐项接受或取消。
 */
import type { AiWritingSuggestion } from "@md-editor/ai";
import type { AiSuggestionItem } from "@md-editor/editor";

export interface GrammarSuggestionTarget {
  /** 被检查文本在文档中的起点 */
  readonly from: number;
  readonly to: number;
  /** 被检查的文本 */
  readonly text: string;
  /** 当前完整文档，用于丢弃已与建议一致的修改 */
  readonly markdown: string;
}

export function toGrammarSuggestionItems(
  suggestion: AiWritingSuggestion,
  target: GrammarSuggestionTarget,
): AiSuggestionItem[] {
  const edit = suggestion.edit;
  if (!suggestion.hasEdit || !edit) return [];

  const diffs = edit.diffs?.length
    ? edit.diffs
    : [
        {
          utf16From: edit.utf16From,
          utf16To: edit.utf16To,
          original: edit.original,
          replacement: edit.replacement,
          kind: undefined,
        },
      ];

  const items: AiSuggestionItem[] = [];
  for (const diff of diffs) {
    let from: number;
    let to: number;
    if (typeof diff.utf16From === "number" && typeof diff.utf16To === "number") {
      from = target.from + diff.utf16From;
      to = target.from + diff.utf16To;
    } else if (diff.original && target.text.includes(diff.original)) {
      // 没有精确偏移时按原文定位（兼容部分云端模型返回的 JSON 结果）。
      from = target.from + target.text.indexOf(diff.original);
      to = from + diff.original.length;
    } else {
      from = target.from;
      to = target.to;
    }
    const current = target.markdown.slice(from, to);
    if (!diff.replacement || diff.original === diff.replacement || current === diff.replacement) {
      continue;
    }
    items.push({
      from,
      to,
      text: diff.replacement,
      originalText: diff.original || current,
      explanation: edit.reason,
      ...(diff.kind ? { kind: diff.kind } : {}),
    });
  }
  return items.toSorted((a, b) => a.from - b.from);
}
