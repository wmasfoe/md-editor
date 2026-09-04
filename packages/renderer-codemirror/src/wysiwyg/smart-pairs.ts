import { EditorSelection, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorModeField } from "../mode.ts";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

/**
 * 选区包裹定界符映射表
 */
const SELECTION_PAIR_MAP: Record<string, [string, string]> = {
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
 * 输入处理器：负责选区包裹（选中文字时输入成对符号自动包裹选区内容）。
 * 空光标状态下不进行任何自动闭合干扰，保证原生 Markdown 体验（如连续输入 ``` 创建代码块）。
 */
export const smartPairsInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing) {
    return false;
  }

  const { state } = view;
  if (state.field(editorModeField, false) === "source") {
    return false;
  }
  const projection = state.field(wysiwygProjectionField, false);
  if (projection && projection.compositionGuardRanges.length > 0) {
    return false;
  }

  // 空光标状态下不进行自动配对或闭合补全，交由 CodeMirror 原生输入
  if (state.selection.main.empty && from === to) {
    return false;
  }

  // 选区包裹：当用户有非空选区且键入了成对定界符时，自动使用定界符包裹选区文字
  const pair = SELECTION_PAIR_MAP[text];
  if (!pair) {
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

/**
 * 智能符号配对扩展（保留选区包裹能力）
 */
export const smartPairsExtension: Extension = [smartPairsInputHandler];
