import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { getWysiwygDiagnostics } from "../../diagnostics.ts";
import { markdownRangeIndexField, type MarkdownRangeIndex } from "../../markdown/range-index.ts";
import { editorModeField } from "../../mode.ts";
import {
  buildInlineStyleDecorations,
  inlineStyleMarkersField,
} from "../projections/inline-heading.ts";
import { isPlainTextInput } from "../input/plain-text-input.ts";
import { equalStrings } from "./atoms.ts";
import { startWysiwygCompositionGuardEffect } from "./types.ts";
import {
  hasWysiwygProjectionFeature,
  projectionStateChanged,
  recordIdsStable,
  wysiwygProjectionField,
} from "./projection-field.ts";

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
    if (!shouldRebuildVisibleMarks(update)) {
      return;
    }

    // G004 P0-2:composition 期间只 map 不重建(全量重建会取消输入法)。
    //
    // 两点都必须覆盖：
    // 1. `update.view.composing` —— 新判据下「仅选区变化 + composing」同样会改变投影身份
    //    （范围选区贴边的显形点集），沿用 `docChanged && composing` 会落到全量重建。
    // 2. `startWysiwygCompositionGuardEffect` 事务 —— compositionstart 本身会改
    //    `compositionGuardRanges` ⇒ 投影身份变化 ⇒ 本插件若据此重建，会在 IME 刚接管 DOM
    //    的瞬间替换装饰节点（正是 P0-2 要避免的场景）。该事务不改变显隐语义：光标既然
    //    落在记录内，`active` 已在上一帧重建中生效；guard 只在组合结束的全量重建里生效。
    if (shouldHoldVisibleMarks(update)) {
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

/**
 * 装饰重建判据 —— 投影派生的**唯一失效契约** + 视口变化。
 *
 * 为什么不再逐项枚举 `docChanged / modeChanged / indexChanged / refreshRequested`：
 * 这些事务在投影层都会产出**新的冻结状态对象**（`compileProjection` /
 * `updateDocumentProjection` / composition 冻结分支），因此被
 * `projectionStateChanged` 蕴含；同时它额外覆盖了本功能最关键的两类变化 ——
 * 选区内激活集变化、以及行内标记显隐开关的 effect 事务。
 *
 * 教训来源（同一类漂移）：`src/wysiwyg/view/focus-mode.ts` 注释明确"无需逐一登记 effect：
 * 遗漏一条就会留下陈旧装饰集"。
 */
export function shouldRebuildVisibleMarks(update: ViewUpdate): boolean {
  return projectionStateChanged(update) || update.viewportChanged;
}

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
  const projection = state.field(wysiwygProjectionField, false);
  const showSourceMarkers = state.field(inlineStyleMarkersField, false) ?? false;
  // 显形集合 = activeSyntaxIds ∪ inlineMarkerRevealIds（并集**只在此处**发生；
  // 投影层只持有 reveal 点集，插件是纯读取者）。
  const activeIds = new Set<string>(projection?.activeSyntaxIds ?? []);
  for (const id of projection?.inlineMarkerRevealIds ?? []) {
    activeIds.add(id);
  }
  const compositionGuardRanges = projection?.compositionGuardRanges ?? [];
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
      .flatMap((record) =>
        buildInlineStyleDecorations(record, {
          active: activeIds.has(record.id),
          showSourceMarkers,
          compositionGuardRanges,
        }),
      ),
  );
  return Decoration.set(ranges, true);
}

/**
 * 组合输入期间是否应"只 map、不重建"。
 *
 * 两个来源都必须覆盖：
 * 1. `update.view.composing` —— 视图处于 IME 组合中；
 * 2. `startWysiwygCompositionGuardEffect` 事务 —— `compositionstart` 会改
 *    `compositionGuardRanges` 从而使投影身份变化，若据此重建会在 IME 刚接管 DOM 的
 *    瞬间替换装饰节点（G004 P0-2 要避免的正是这个）。
 *
 * 该事务不改变显隐语义：光标既然落在记录内，`active` 已在上一帧重建中生效；
 * guard 区间只在 `compositionend` 派发的 refresh effect 全量重建里生效。
 */
export function shouldHoldVisibleMarks(update: ViewUpdate): boolean {
  if (update.view.composing) {
    return true;
  }
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(startWysiwygCompositionGuardEffect)),
  );
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
 *
 * 另加显形集稳定性前置：激活集或显形点集发生元素级变化时必须回退全量重建，
 * 否则快速路径会保留上一帧的 marker 显隐（陈旧）。
 */
export function plainTextInputCanMapVisibleMarks(
  update: ViewUpdate,
  modeChanged: boolean,
  visibleRangesMapExactly: boolean,
): boolean {
  const changedTransactionCount = update.transactions.filter(
    (transaction) => transaction.docChanged,
  ).length;
  // `modeChanged` 现在也被 `projectionStateChanged` 蕴含，保留形参只为不动既有调用点与断言。
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
  const previousProjection = update.startState.field(wysiwygProjectionField, false);
  const projection = update.state.field(wysiwygProjectionField, false);
  if (previousProjection === undefined || projection === undefined) {
    return false;
  }
  return (
    cursorNotInsideInlineMarker(previousIndex, before.head) &&
    cursorNotInsideInlineMarker(index, after.head) &&
    // 元素级（而非身份）比较：`compileProjection` 每次都会产出新数组，
    // 身份比较会让快速路径永不命中（G004 早期断言依赖它仍然命中）。
    //
    // 说明：显形点集的稳定性判据目前是**防御性**的 —— 纯插入事务不会改变 `touching`
    // 结果（光标位置随插入平移，记录也随之平移），因此现实中很难构造"reveal 变而
    // active 不变"的纯文本插入。保留它是因为一旦将来显形来源与选区解耦（例如按 kind
    // 分开关），缺了这条就会静默保留上一帧的 marker 显隐。
    equalStrings(previousProjection.activeSyntaxIds, projection.activeSyntaxIds) &&
    equalStrings(previousProjection.inlineMarkerRevealIds, projection.inlineMarkerRevealIds) &&
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
