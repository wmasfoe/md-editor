import {
  Annotation,
  EditorState,
  StateEffect,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorModeField } from "../mode.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

export const authorizeWysiwygProtectedChange = Annotation.define<boolean>();
export const protectedWysiwygChangeRejectedEffect = StateEffect.define<null>();
export const WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE =
  "This Markdown syntax can only be edited in source mode.";

export const wysiwygChangeProtection: Extension = EditorState.transactionFilter.of(
  (transaction) => {
    if (isWysiwygChangeAllowed(transaction)) {
      return transaction;
    }
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
    transaction.annotation(authorizeWysiwygProtectedChange) === true
  ) {
    return true;
  }

  const protectedRanges = transaction.startState.field(wysiwygProjectionField).protectedRanges;
  if (protectedRanges.length === 0) {
    return true;
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
          (selection.from < protectedRange.from || selection.to > protectedRange.to),
      );
      if (!broadSelectionCoversRange) {
        allowed = false;
        return;
      }
    }
  });
  return allowed;
}

function changesTouchRange(from: number, to: number, rangeFrom: number, rangeTo: number): boolean {
  return from === to ? from > rangeFrom && from < rangeTo : from < rangeTo && to > rangeFrom;
}
