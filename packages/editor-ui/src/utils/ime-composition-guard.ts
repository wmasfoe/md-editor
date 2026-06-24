import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  Plugin,
  PluginKey,
  type Selection,
  type SelectionBookmark,
  type Transaction
} from "@milkdown/kit/prose/state";

const imeCompositionGuardKey = new PluginKey("md-editor-ime-composition-guard");
const IME_COMPOSITION_SETTLE_DELAY_MS = 260;

interface CompositionStartSnapshot {
  readonly doc: ProseMirrorNode;
  readonly selection: Selection;
  readonly bookmark: SelectionBookmark;
}

interface CompositionDomObserver {
  readonly forceFlush?: () => void;
  readonly flush?: () => void;
}

export const imeCompositionGuardPlugin = $prose(
  () => {
    let isComposing = false;
    let compositionEndTimer: ReturnType<typeof setTimeout> | null = null;
    let compositionStartSnapshot: CompositionStartSnapshot | null = null;

    const clearCompositionEndTimer = () => {
      if (compositionEndTimer !== null) {
        clearTimeout(compositionEndTimer);
        compositionEndTimer = null;
      }
    };

    const startComposition = (view: EditorView) => {
      clearCompositionEndTimer();
      isComposing = true;
      compositionStartSnapshot = {
        doc: view.state.doc,
        selection: view.state.selection,
        bookmark: view.state.selection.getBookmark()
      };
    };

    const finishCompositionSoon = (view: EditorView) => {
      clearCompositionEndTimer();
      compositionEndTimer = setTimeout(() => {
        compositionEndTimer = null;
        isComposing = false;
        // Some IMEs leave ProseMirror's composition DOM pending until the
        // next input. Settle it here so CJK input does not need an ASCII key
        // press to repair layout or caret state.
        forceCompositionDomFlush(view);
        refreshCompositionDom(view);
        restoreCancelledCompositionSelection(view, compositionStartSnapshot);
        compositionStartSnapshot = null;
      }, IME_COMPOSITION_SETTLE_DELAY_MS);
    };

    return new Plugin({
      key: imeCompositionGuardKey,
      appendTransaction(transactions, oldState, newState) {
        if (!isComposing && !transactions.some(isCompositionTransaction)) {
          return;
        }

        const positions = findIntroducedHardbreakPositions(oldState.doc, newState.doc, transactions);
        if (positions.length === 0) {
          return;
        }

        let transaction = newState.tr;
        for (const position of positions.reverse()) {
          const node = transaction.doc.nodeAt(position);
          if (node?.type.name === "hardbreak") {
            transaction = transaction.delete(position, position + node.nodeSize);
          }
        }

        return transaction;
      },
      props: {
        handleDOMEvents: {
          compositionstart(view) {
            startComposition(view);
            return false;
          },
          compositionend(view) {
            finishCompositionSoon(view);
            return false;
          }
        }
      },
      view: () => ({
        destroy() {
          clearCompositionEndTimer();
          compositionStartSnapshot = null;
        }
      })
    });
  }
);

export function findIntroducedHardbreakPositions(
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
  transactions: readonly Transaction[]
): number[] {
  const mappedExistingHardbreaks = mapExistingHardbreakPositions(
    findHardbreakPositions(oldDoc),
    transactions
  );

  return findHardbreakPositions(newDoc).filter((position) => !mappedExistingHardbreaks.has(position));
}

export function forceCompositionDomFlush(view: unknown): boolean {
  const observer = (view as { readonly domObserver?: CompositionDomObserver }).domObserver;
  if (!observer) {
    return false;
  }

  let didFlush = false;
  if (typeof observer.forceFlush === "function") {
    observer.forceFlush();
    didFlush = true;
  }
  if (typeof observer.flush === "function") {
    observer.flush();
    didFlush = true;
  }

  return didFlush;
}

export function refreshCompositionDom(
  view: Pick<EditorView, "dispatch" | "state">
): void {
  view.dispatch(
    view.state.tr
      .setMeta("addToHistory", false)
      .setMeta(imeCompositionGuardKey, "refresh-composition-dom")
  );
}

export function shouldRestoreCancelledCompositionSelection(
  startDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode,
  startSelection: Selection,
  currentSelection: Selection
): boolean {
  return (
    startDoc.eq(currentDoc) &&
    startSelection.empty &&
    currentSelection.empty &&
    !startSelection.eq(currentSelection)
  );
}

function isCompositionTransaction(transaction: Transaction): boolean {
  return transaction.getMeta("composition") !== undefined;
}

function restoreCancelledCompositionSelection(
  view: EditorView,
  snapshot: CompositionStartSnapshot | null
): boolean {
  if (
    !snapshot ||
    !shouldRestoreCancelledCompositionSelection(
      snapshot.doc,
      view.state.doc,
      snapshot.selection,
      view.state.selection
    )
  ) {
    return false;
  }

  const restoredSelection = snapshot.bookmark.resolve(view.state.doc);
  if (restoredSelection.eq(view.state.selection)) {
    return false;
  }

  view.dispatch(
    view.state.tr
      .setSelection(restoredSelection)
      .setMeta("addToHistory", false)
      .setMeta(imeCompositionGuardKey, "restore-cancelled-composition-selection")
  );
  return true;
}

function findHardbreakPositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "hardbreak") {
      positions.push(position);
    }
    return true;
  });
  return positions;
}

function mapExistingHardbreakPositions(
  positions: readonly number[],
  transactions: readonly Transaction[]
): Set<number> {
  const mapped = new Set<number>();

  for (const position of positions) {
    let currentPosition = position;
    let deleted = false;

    for (const transaction of transactions) {
      const result = transaction.mapping.mapResult(currentPosition, 1);
      if (result.deleted) {
        deleted = true;
        break;
      }
      currentPosition = result.pos;
    }

    if (!deleted) {
      mapped.add(currentPosition);
    }
  }

  return mapped;
}
