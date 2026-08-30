import { EditorSelection, Prec, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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
 * 空光标自动闭合配对表
 */
const AUTO_CLOSE_PAIRS: Record<string, [string, string]> = {
  "(": ["(", ")"],
  "[": ["[", "]"],
  "{": ["{", "}"],
  '"': ['"', '"'],
  "'": ["'", "'"],
  "`": ["`", "`"],
  "<": ["<", ">"],
};

/**
 * 闭合字符列表（用于输入闭合字符时的光标跳过 step-over）
 */
const CLOSING_CHARS = new Set([")", "]", "}", '"', "'", "`", ">"]);

/**
 * 判断两个相邻字符是否构成成对符号
 */
function isMatchingPair(before: string, after: string): boolean {
  return (
    (before === "(" && after === ")") ||
    (before === "[" && after === "]") ||
    (before === "{" && after === "}") ||
    (before === '"' && after === '"') ||
    (before === "'" && after === "'") ||
    (before === "`" && after === "`") ||
    (before === "<" && after === ">")
  );
}

/**
 * 输入处理器：负责选区包裹、空光标成对自动闭合、以及输入闭合符号时的 step-over 跳过。
 */
export const smartPairsInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing) {
    return false;
  }

  const { state } = view;
  const projection = state.field(wysiwygProjectionField, false);
  if (projection && projection.compositionGuardRanges.length > 0) {
    return false;
  }

  const isSelectionEmpty = state.selection.main.empty && from === to;

  // 1. 空光标状态下的处理
  if (isSelectionEmpty) {
    // 1.1 Step-over 机制：当光标紧跟闭合符号且用户键入了相同的闭合符号时，直接跳过而不重复输入
    if (CLOSING_CHARS.has(text)) {
      const nextChar = state.sliceDoc(from, from + text.length);
      if (nextChar === text) {
        view.dispatch({
          selection: EditorSelection.cursor(from + text.length),
          userEvent: "select",
        });
        return true;
      }
    }

    // 1.2 自动闭合机制：输入开符号自动补全对应闭合符号并将光标置于中间
    const autoPair = AUTO_CLOSE_PAIRS[text];
    if (autoPair) {
      const [openChar, closeChar] = autoPair;

      // 单引号保护：若光标前是字母/数字（如 don't），视作缩写撇号，不自动闭合
      if (text === "'") {
        const prevChar = from > 0 ? state.sliceDoc(from - 1, from) : "";
        if (/\w/u.test(prevChar)) {
          return false;
        }
      }

      // 若光标后紧跟单词字符，不自动闭合（避免干扰在单词中间打字）
      const nextChar = state.sliceDoc(to, to + 1);
      if (/\w/u.test(nextChar)) {
        return false;
      }

      const insert = `${openChar}${closeChar}`;
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + openChar.length),
        annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
        userEvent: "input.type",
      });
      return true;
    }

    return false;
  }

  // 2. 非空选区状态下的处理（选区包裹）
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
 * 成对符号 Backspace 联动删除快捷键：
 * 当光标位于空配对符号中间（如 (|)、[|]、{|}、""、''、``）时，按 Backspace 同时删除左右两边的符号。
 */
const smartPairsBackspaceKeymap = Prec.high(
  keymap.of([
    {
      key: "Backspace",
      run: (view) => {
        const { state, dispatch } = view;
        const { main } = state.selection;
        if (!main.empty || main.head === 0 || main.head >= state.doc.length) {
          return false;
        }
        const pos = main.head;
        const before = state.sliceDoc(pos - 1, pos);
        const after = state.sliceDoc(pos, pos + 1);
        if (isMatchingPair(before, after)) {
          dispatch(
            state.update({
              changes: { from: pos - 1, to: pos + 1, insert: "" },
              selection: EditorSelection.cursor(pos - 1),
              annotations: [
                Transaction.addToHistory.of(true),
                authorizeWysiwygProtectedChange.of(true),
              ],
              userEvent: "delete.backward",
            }),
          );
          return true;
        }
        return false;
      },
    },
  ]),
);

/**
 * 智能符号配对扩展（支持选区包裹、空光标自动闭合、闭合符 step-over 与 Backspace 成对删除）
 */
export const smartPairsExtension: Extension = [smartPairsInputHandler, smartPairsBackspaceKeymap];
