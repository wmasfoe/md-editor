import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";

const imeCompositionGuardKey = new PluginKey("md-editor-ime-composition-guard");
const IME_COMPOSITION_SETTLE_DELAY_MS = 260;

export const imeCompositionGuardPlugin = $prose(
  () => {
    let isComposing = false;
    let compositionEndTimer: ReturnType<typeof setTimeout> | null = null;

    const clearCompositionEndTimer = () => {
      if (compositionEndTimer !== null) {
        clearTimeout(compositionEndTimer);
        compositionEndTimer = null;
      }
    };

    const startComposition = () => {
      clearCompositionEndTimer();
      isComposing = true;
    };

    const finishCompositionSoon = () => {
      clearCompositionEndTimer();
      compositionEndTimer = setTimeout(() => {
        compositionEndTimer = null;
        isComposing = false;
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
          compositionstart() {
            startComposition();
            return false;
          },
          compositionend() {
            finishCompositionSoon();
            return false;
          }
        }
      },
      view: () => ({
        destroy: clearCompositionEndTimer
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

function isCompositionTransaction(transaction: Transaction): boolean {
  return transaction.getMeta("composition") !== undefined;
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
