import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { authorizeWysiwygProtectedChange } from "./change-authorization.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

/**
 * 校验是否为合法 URL
 */
export function isValidUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  // 必须以标准协议开头
  if (!/^(https?|ftp|mailto):\/\/[^\s]+$/i.test(trimmed)) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    return Boolean(url.protocol && url.host);
  } catch {
    return false;
  }
}

/**
 * 智能链接粘贴扩展：
 * 当选中文本时粘贴有效 URL，自动转换为 Markdown 链接格式 [选中文字](URL)，
 * 避免先输入 []() 再填入的繁琐操作。
 */
export const smartLinkPasteExtension = EditorView.domEventHandlers({
  paste(event: ClipboardEvent, view: EditorView) {
    if (view.composing) {
      return false;
    }

    const clipboardText = event.clipboardData?.getData("text/plain")?.trim();
    if (!clipboardText || !isValidUrl(clipboardText)) {
      return false;
    }

    const { state } = view;
    const projection = state.field(wysiwygProjectionField, false);
    if (projection && projection.compositionGuardRanges.length > 0) {
      return false;
    }

    // 必须有非空选区
    const nonRanges = state.selection.ranges.filter((r) => !r.empty);
    if (nonRanges.length === 0) {
      return false;
    }

    const changes: { from: number; to: number; insert: string }[] = [];
    const newRanges: { anchor: number; head: number }[] = [];

    const sortedRanges = nonRanges.toSorted((a, b) => b.from - a.from);

    for (const range of sortedRanges) {
      const selectedText = state.sliceDoc(range.from, range.to);
      // 若选中文本本身已包含未闭合的 markdown 链接语法，则回退常规粘贴
      if (selectedText.startsWith("[") && selectedText.endsWith(")")) {
        return false;
      }

      const wrapped = `[${selectedText}](${clipboardText})`;
      changes.push({ from: range.from, to: range.to, insert: wrapped });
      // 光标停在链接之后
      const endPos = range.from + wrapped.length;
      newRanges.push({ anchor: endPos, head: endPos });
    }

    if (changes.length === 0) {
      return false;
    }

    event.preventDefault();
    const finalRanges = newRanges.toReversed();

    view.dispatch({
      changes,
      selection: EditorSelection.create(
        finalRanges.map((r) => EditorSelection.range(r.anchor, r.head)),
      ),
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
      userEvent: "input.paste",
    });

    return true;
  },
});
