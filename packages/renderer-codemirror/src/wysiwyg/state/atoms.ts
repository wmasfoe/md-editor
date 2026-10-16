/** Atom selection, composition effects, and immutable state helpers. */
import type { StateEffect, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { type MarkdownRangeIndex } from "../../markdown/range-index.ts";
import type { SourceRange } from "../../markdown/range-types.ts";
import { isRenderableDefaultAtom } from "../blocks/default-visualization.ts";
import { freezeRanges } from "./ranges.ts";
import {
  clearWysiwygAtomSelectionEffect,
  clearWysiwygTypedBoundaryEffect,
  endWysiwygCompositionGuardEffect,
  selectWysiwygAtomEffect,
  startWysiwygCompositionGuardEffect,
  type WysiwygProjectionState,
} from "./types.ts";

export function applyAtomEffects(
  previous: readonly string[],
  effects: readonly StateEffect<unknown>[],
): readonly string[] {
  let next = previous;
  for (const effect of effects) {
    if (effect.is(clearWysiwygAtomSelectionEffect)) {
      next = Object.freeze([]);
    } else if (effect.is(selectWysiwygAtomEffect)) {
      const ids = effect.value.extend ? new Set(next) : new Set<string>();
      ids.add(effect.value.recordId);
      next = sortStrings(ids);
    }
  }
  return next;
}

export function normalizeSelectedAtomIds(
  index: MarkdownRangeIndex,
  selectedAtomIds: readonly string[],
  selection: EditorSelection,
  state: EditorState,
  previous: readonly string[],
): readonly string[] {
  const normalized = sortStrings(
    selectedAtomIds.filter((id) => {
      const record = index.get(id);
      return (
        record !== null &&
        (record.kind === "image" ||
          record.kind === "thematic-break" ||
          record.kind === "table" ||
          record.kind === "html" ||
          record.kind === "mdx-jsx" ||
          isRenderableDefaultAtom(record, state)) &&
        selection.ranges.some(
          (range) =>
            !range.empty &&
            range.from === record.fullRange.from &&
            range.to === record.fullRange.to,
        )
      );
    }),
  );
  return equalStrings(normalized, previous) ? previous : normalized;
}

export function applyCompositionEffects(
  previous: readonly SourceRange[],
  effects: readonly StateEffect<unknown>[],
): readonly SourceRange[] {
  let next = previous;
  for (const effect of effects) {
    if (effect.is(startWysiwygCompositionGuardEffect)) {
      next = freezeRanges(effect.value);
    } else if (effect.is(endWysiwygCompositionGuardEffect)) {
      next = Object.freeze([]);
    }
  }
  return next;
}

/**
 * G004 P0-3 typedBoundary 计算:
 * - 用户输入事务(打字)且单光标空选区 → 记录输入后的光标位置;
 * - 其他 doc 变化(粘贴/删除/外部编辑)或选区变化(用户移动光标)→ 清空;
 * - 其余保持。
 * 不需要 renderer 额外 dispatch:输入事务本身就是 typedBoundary 的载体。
 */
export function computeTypedBoundary(
  previous: number | null,
  transaction: Transaction,
): number | null {
  if (transaction.effects.some((effect) => effect.is(clearWysiwygTypedBoundaryEffect))) {
    return null;
  }
  if (
    transaction.isUserEvent("input") &&
    transaction.state.selection.ranges.length === 1 &&
    transaction.state.selection.main.empty
  ) {
    return transaction.state.selection.main.head;
  }
  if (transaction.docChanged || transaction.selection) {
    return null;
  }
  return previous;
}

export function freezeProjectionState(state: WysiwygProjectionState): WysiwygProjectionState {
  return Object.freeze({
    ...state,
    activeSyntaxIds: freezeStrings(state.activeSyntaxIds),
    selectedAtomIds: freezeStrings(state.selectedAtomIds),
    compositionGuardRanges: freezeRanges(state.compositionGuardRanges),
    protectedRanges: freezeRanges(state.protectedRanges),
    lastSelectionDeltaIds: freezeStrings(state.lastSelectionDeltaIds),
    visibleRanges: freezeRanges(state.visibleRanges),
  });
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.isFrozen(values) ? values : Object.freeze([...values]);
}

export function sortStrings(values: Iterable<string>): readonly string[] {
  const sorted: string[] = [];
  for (const value of values) {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (sorted[middle].localeCompare(value) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    sorted.splice(low, 0, value);
  }
  return Object.freeze(sorted);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
