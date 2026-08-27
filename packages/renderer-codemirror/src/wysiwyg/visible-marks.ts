import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField, type MarkdownRangeIndex } from "../markdown/range-index.ts";
import { editorModeField } from "../mode.ts";
import { buildInlineStyleDecorations } from "./inline-heading.ts";
import { isPlainTextInput } from "./plain-text-input.ts";
import {
  hasWysiwygProjectionFeature,
  recordIdsStable,
  refreshWysiwygProjectionEffect,
} from "./projection-state.ts";

class VisibleMarkdownMarks {
  decorations: DecorationSet;
  visibleRanges: readonly { readonly from: number; readonly to: number }[];

  constructor(view: EditorView) {
    this.decorations = buildVisibleMarkdownMarks(view);
    this.visibleRanges = snapshotVisibleRanges(view);
  }

  update(update: ViewUpdate): void {
    const visibleRangesMapExactly = mappedVisibleRangesEqual(
      this.visibleRanges,
      update.view.visibleRanges,
      update.changes,
    );
    this.visibleRanges = snapshotVisibleRanges(update.view);
    const modeChanged =
      update.startState.field(editorModeField) !== update.state.field(editorModeField);
    const indexChanged =
      update.startState.field(markdownRangeIndexField) !==
      update.state.field(markdownRangeIndexField);
    const refreshRequested = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(refreshWysiwygProjectionEffect)),
    );
    if (
      !update.docChanged &&
      !update.viewportChanged &&
      !modeChanged &&
      !indexChanged &&
      !refreshRequested
    ) {
      return;
    }

    if (refreshRequested) {
      this.decorations = buildVisibleMarkdownMarks(update.view);
      return;
    }

    // G004 P0-2:composition 期间只 map 不重建(全量重建会取消输入法)。
    if (update.docChanged && update.view.composing) {
      this.decorations = this.decorations.map(update.changes);
      return;
    }

    // G004 P0-1 纯文本输入快速路径:字母/数字插入且光标不在行内标记的 marker 内,
    // 装饰(mark 类型)位置 map 后即精确,跳过 visibleRanges 全量重算。
    if (plainTextInputCanMapVisibleMarks(update, modeChanged, visibleRangesMapExactly)) {
      getWysiwygDiagnostics(update.state)?.recordVisibleMarkMapSkip();
      this.decorations = this.decorations.map(update.changes);
      return;
    }

    this.decorations = buildVisibleMarkdownMarks(update.view);
  }
}

export const visibleMarkdownMarksPlugin = ViewPlugin.fromClass(VisibleMarkdownMarks, {
  decorations: (plugin) => plugin.decorations,
});

export function buildVisibleMarkdownMarks(view: EditorView): DecorationSet {
  const state = view.state;
  getWysiwygDiagnostics(state)?.recordVisibleMarkBuild();
  if (
    state.field(editorModeField) === "source" ||
    !hasWysiwygProjectionFeature(state, "inline-styles")
  ) {
    return Decoration.none;
  }

  const index = state.field(markdownRangeIndexField);
  const seen = new Set<string>();
  const ranges = view.visibleRanges.flatMap((visibleRange) =>
    index
      .overlapping(visibleRange.from, visibleRange.to)
      .filter((record) => {
        if (seen.has(record.id)) {
          return false;
        }
        seen.add(record.id);
        return record.renderPolicy === "inline-visible-markers" && record.contentRange !== null;
      })
      .flatMap((record) => buildInlineStyleDecorations(record)),
  );
  return Decoration.set(ranges, true);
}

/**
 * G004 P0-1:事务是否"只插入纯文本"(字母/组合标记/数字,无结构字符)。
 * 判定条件:fromA === toA(纯插入)且插入内容只含 \p{L}\p{M}\p{N}——
 * `*`/`#`/`` ` ``/`[` 等可能产生新语法结构的字符被排除。
 */
function updateOnlyInsertsPlainText(update: ViewUpdate): boolean {
  if (
    !update.docChanged ||
    update.focusChanged ||
    update.transactions.some((transaction) => transaction.reconfigured) ||
    update.transactions.some(
      (transaction) => transaction.docChanged && !transaction.isUserEvent("input"),
    )
  ) {
    return false;
  }
  let plainInsertion = true;
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (fromA !== toA || !isPlainTextInput(inserted.toString())) {
      plainInsertion = false;
    }
  });
  return plainInsertion;
}

/**
 * G004 P0-1 完整判定:纯文本插入 + 单光标空选区 + 光标不在行内标记的 marker 内
 * (在 marker 内插入会改变标记结构,如 `**` 中间插入字母会变成斜体语法)。
 */
export function plainTextInputCanMapVisibleMarks(
  update: ViewUpdate,
  modeChanged: boolean,
  visibleRangesMapExactly: boolean,
): boolean {
  const changedTransactionCount = update.transactions.filter(
    (transaction) => transaction.docChanged,
  ).length;
  if (
    modeChanged ||
    (update.viewportChanged && !visibleRangesMapExactly) ||
    changedTransactionCount !== 1
  ) {
    return false;
  }
  if (!updateOnlyInsertsPlainText(update)) {
    return false;
  }
  const before = update.startState.selection.main;
  const after = update.state.selection.main;
  if (!before.empty || !after.empty) {
    return false;
  }
  if (update.startState.selection.ranges.length !== 1) {
    return false;
  }
  if (update.state.selection.ranges.length !== 1) {
    return false;
  }
  const previousIndex = update.startState.field(markdownRangeIndexField);
  const index = update.state.field(markdownRangeIndexField);
  return (
    cursorNotInsideInlineMarker(previousIndex, before.head) &&
    cursorNotInsideInlineMarker(index, after.head) &&
    // 与 projection 快速路径一致:结构记录前的纯文本插入会改变后续 record
    // 的绝对偏移 ID,map 后的装饰仍携带旧 wysiwygRecordId,必须回退重建。
    recordIdsStable(previousIndex, index)
  );
}

function snapshotVisibleRanges(
  view: Pick<EditorView, "visibleRanges">,
): readonly { readonly from: number; readonly to: number }[] {
  return Object.freeze(view.visibleRanges.map((range) => Object.freeze({ ...range })));
}

function mappedVisibleRangesEqual(
  previous: readonly { readonly from: number; readonly to: number }[],
  current: readonly { readonly from: number; readonly to: number }[],
  changes: ViewUpdate["changes"],
): boolean {
  return (
    previous.length === current.length &&
    previous.every(
      (range, index) =>
        changes.mapPos(range.from, -1) === current[index]?.from &&
        changes.mapPos(range.to, 1) === current[index]?.to,
    )
  );
}

/** 光标不在任何 inline-visible-markers 记录的 marker 内部 */
function cursorNotInsideInlineMarker(index: MarkdownRangeIndex, position: number): boolean {
  for (const record of index.overlapping(position, position)) {
    if (record.renderPolicy !== "inline-visible-markers") {
      continue;
    }
    for (const marker of record.markerRanges) {
      if (position >= marker.from && position <= marker.to) {
        return false;
      }
    }
  }
  return true;
}
