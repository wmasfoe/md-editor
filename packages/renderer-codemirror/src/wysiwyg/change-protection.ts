import { EditorState, StateEffect, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorModeField } from "../mode.ts";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import {
  authorizeWysiwygProtectedChange,
  isWysiwygStructuredCommandAuthorized,
} from "./change-authorization.ts";
import { wysiwygProjectionField } from "./projection-state.ts";
import { getCodeBlockProtectedRanges } from "./code-block-projection.ts";

export const protectedWysiwygChangeRejectedEffect = StateEffect.define<null>();
export const WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE =
  "This Markdown syntax can only be edited in source mode.";

export const wysiwygChangeProtection: Extension = EditorState.transactionFilter.of(
  (transaction) => {
    if (isWysiwygChangeAllowed(transaction)) {
      return transaction;
    }
    getWysiwygDiagnostics(transaction.startState)?.recordProtectedChangeRejection();
    // Replace the rejected transaction so its explicit selection cannot move
    // after the document change is removed.
    return {
      selection: transaction.startState.selection,
      effects: [
        protectedWysiwygChangeRejectedEffect.of(null),
        EditorView.announce.of(WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE),
      ],
      annotations: Transaction.addToHistory.of(false),
      userEvent: "input.wysiwyg-protected",
    };
  },
);

export function isWysiwygChangeAllowed(transaction: Transaction): boolean {
  if (
    !transaction.docChanged ||
    transaction.startState.field(editorModeField) === "source" ||
    transaction.isUserEvent("undo") ||
    transaction.isUserEvent("redo") ||
    isWysiwygStructuredCommandAuthorized(transaction.startState) ||
    transaction.annotation(authorizeWysiwygProtectedChange) === true
  ) {
    return true;
  }

  const protectedRanges = transaction.startState.field(wysiwygProjectionField).protectedRanges;
  if (protectedRanges.length === 0) {
    return true;
  }
  if (transactionTouchesCodeBlockSyntax(transaction)) {
    return false;
  }

  let allowed = true;
  transaction.changes.iterChangedRanges((from, to) => {
    if (!allowed) {
      return;
    }
    for (const protectedRange of protectedRanges) {
      if (!changesTouchRange(from, to, protectedRange.from, protectedRange.to)) {
        continue;
      }
      const broadSelectionCoversRange = transaction.startState.selection.ranges.some(
        (selection) =>
          !selection.empty &&
          selection.from <= protectedRange.from &&
          selection.to >= protectedRange.to &&
          // 按 provenance kind 区分放行语义：
          // - table/html：恰好相等选区也放行（整块原子选中后直接打字/粘贴/Delete
          //   等价于"先删整表再输入"）；同时容忍拖选含尾随换行
          //   （selection.to 到 fullRange.to + 1，layout decoration 替换范围含尾随换行）。
          // - 其他来源：必须严格更宽（G012 语义：恰好拒绝、跨块更宽才放行），
          //   避免默认 atom（footnote/autolink/reference）被恰好选区静默删除。
          (protectedRange.kind === "table" ||
            protectedRange.kind === "html" ||
            selection.from < protectedRange.from ||
            selection.to > protectedRange.to),
      );
      if (!broadSelectionCoversRange) {
        allowed = false;
        return;
      }
    }
  });
  return allowed;
}

function transactionTouchesCodeBlockSyntax(transaction: Transaction): boolean {
  const protectedCodeRanges = transaction.startState
    .field(markdownRangeIndexField)
    .byKind("deferred-code")
    .flatMap(getCodeBlockProtectedRanges);
  let touchesCodeSyntax = false;
  transaction.changes.iterChangedRanges((from, to) => {
    if (protectedCodeRanges.some((range) => changesTouchRange(from, to, range.from, range.to))) {
      touchesCodeSyntax = true;
    }
  });
  return touchesCodeSyntax;
}

function changesTouchRange(from: number, to: number, rangeFrom: number, rangeTo: number): boolean {
  return from === to ? from > rangeFrom && from < rangeTo : from < rangeTo && to > rangeFrom;
}
