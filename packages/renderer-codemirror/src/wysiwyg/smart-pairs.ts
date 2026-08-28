import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

const PAIR_MAP: Record<string, [string, string]> = {
  "*": ["*", "*"],
  _: ["_", "_"],
  "`": ["`", "`"],
  "~": ["~~", "~~"],
  "[": ["[", "]"],
  "(": ["(", ")"],
  '"': ['"', '"'],
  "'": ["'", "'"],
  "{": ["{", "}"],
  "<": ["<", ">"],
};

/**
 * 选区定界符自动包裹扩展（Auto-wrapping selection with punctuation / markdown pairs）：
 * 当选中一段文本时输入成对符号（如 *、_、`、~、[、(、"、'），自动将选中文本包裹，
 * 并保留选中内容，极大提升 Markdown 写作流畅度。
 */
export const smartPairsExtension = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing) {
    return false;
  }

  // 仅在输入单字符且存在对应配对规则时生效
  const pair = PAIR_MAP[text];
  if (!pair) {
    return false;
  }

  const { state } = view;
  const projection = state.field(wysiwygProjectionField, false);
  if (projection && projection.compositionGuardRanges.length > 0) {
    return false;
  }

  // 必须有非空选区
  if (from === to && state.selection.main.empty) {
    return false;
  }

  const [openChar, closeChar] = pair;
  const changes: { from: number; to: number; insert: string }[] = [];
  const newRanges: { anchor: number; head: number }[] = [];

  const nonRanges = state.selection.ranges.filter((r) => !r.empty);
  if (nonRanges.length === 0) {
    return false;
  }

  const sortedRanges = nonRanges.toSorted((a, b) => b.from - a.from);

  for (const range of sortedRanges) {
    const selectedText = state.sliceDoc(range.from, range.to);
    const wrapped = `${openChar}${selectedText}${closeChar}`;
    changes.push({ from: range.from, to: range.to, insert: wrapped });
    // 保持包裹后的内容处于选中状态
    newRanges.push({
      anchor: range.from + openChar.length,
      head: range.from + openChar.length + selectedText.length,
    });
  }

  if (changes.length === 0) {
    return false;
  }

  const finalRanges = newRanges.toReversed();

  view.dispatch({
    changes,
    selection: EditorSelection.create(
      finalRanges.map((r) => EditorSelection.range(r.anchor, r.head)),
    ),
    annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.type",
  });

  return true;
});
