import {
  Facet,
  StateEffect,
  StateField,
  type EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorMode } from "@md-editor/editor-core";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import { markdownRangeIndexField, type MarkdownRangeIndex } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord, SourceRange } from "../markdown/range-types.ts";
import { editorModeField } from "../mode.ts";
import { buildHeadingLayoutDecorations } from "./inline-heading.ts";
import { buildLinkMediaAtomicRanges, buildLinkMediaLayoutDecorations } from "./link-projection.ts";
import {
  buildBlockAtomicRanges,
  buildBlockLayoutDecorations,
  getBlockProtectedRanges,
} from "./list-projection.ts";
import {
  buildDefaultAtomAtomicRanges,
  buildDefaultAtomLayoutDecorations,
  isRenderableDefaultAtom,
} from "./default-visualization.ts";
import {
  buildFrontmatterAtomicRanges,
  buildFrontmatterLayoutDecorations,
  getFrontmatterProtectedRanges,
} from "./frontmatter-projection.ts";
import {
  buildCodeBlockAtomicRanges,
  buildCodeBlockLayoutDecorations,
  codeBlockLineNumbersField,
  getCodeBlockProtectedRanges,
  setCodeBlockLineNumbersEffect,
} from "./code-block-projection.ts";
import {
  buildTableAtomicRanges,
  buildTableLayoutDecorations,
  getTableProtectedRanges,
  isProjectableTable,
} from "./table-projection.ts";
import {
  buildHtmlAtomicRanges,
  buildHtmlLayoutDecorations,
  getHtmlProtectedRanges,
  isProjectableHtml,
} from "./html-projection.ts";
import {
  buildMdxAtomicRanges,
  buildMdxLayoutDecorations,
  getMdxProtectedRanges,
  isProjectableMdx,
} from "./mdx-projection.ts";
import { isPlainTextInput } from "./plain-text-input.ts";

export type WysiwygProjectionFeature =
  | "inline-styles"
  | "headings"
  | "blocks"
  | "links"
  | "images"
  | "thematic-breaks"
  | "default-atoms"
  | "frontmatter"
  | "tables"
  | "html"
  | "mdx";

export interface SelectWysiwygAtomEffect {
  readonly recordId: string;
  readonly extend: boolean;
}

/**
 * protected range 的 provenance 来源类型。
 *
 * 宽选区放行语义按 kind 区分：table/html 允许"恰好相等选区"（整块原子选中后
 * 直接打字/粘贴等价于替换整块）；其余来源必须严格更宽（G012 语义：
 * 恰好拒绝、跨块更宽才放行）。携带 kind 保证判定不依赖几何形状，
 * 未来新增来源只增加一个 kind 值。
 */
export type ProtectedRangeKind =
  "default-atom" | "frontmatter" | "block-marker" | "code" | "table" | "html" | "mdx";

export interface ProtectedSourceRange extends SourceRange {
  readonly kind: ProtectedRangeKind;
}

export interface WysiwygProjectionSnapshot {
  readonly mode: EditorMode;
  readonly rangeIndexVersion: number;
  readonly activeSyntaxIds: readonly string[];
  readonly selectedAtomIds: readonly string[];
  readonly compositionGuardRanges: readonly SourceRange[];
  readonly protectedRanges: readonly ProtectedSourceRange[];
  readonly layoutDecorationCount: number;
  readonly atomicRangeCount: number;
  readonly lastSelectionDeltaIds: readonly string[];
}

export interface WysiwygProjectionState {
  readonly mode: EditorMode;
  readonly rangeIndexVersion: number;
  readonly activeSyntaxIds: readonly string[];
  readonly selectedAtomIds: readonly string[];
  readonly compositionGuardRanges: readonly SourceRange[];
  readonly protectedRanges: readonly ProtectedSourceRange[];
  readonly layoutDecorations: DecorationSet;
  readonly atomicRanges: DecorationSet;
  readonly lastSelectionDeltaIds: readonly string[];
  /** 刚由输入事务产生的光标位置;用于 reveal-source 记录闭合符右缘的 reveal 宽松判定 */
  readonly typedBoundary: number | null;
  /** 最近一次可见区(EditorView 几何采集,effect 注入);空 = 未初始化,全量构建 */
  readonly visibleRanges: readonly SourceRange[];
}

const configuredProjectionFeatures = Facet.define<
  readonly WysiwygProjectionFeature[],
  readonly WysiwygProjectionFeature[]
>({
  combine(values) {
    return Object.freeze([...new Set(values.flat())]);
  },
});

export const selectWysiwygAtomEffect = StateEffect.define<SelectWysiwygAtomEffect>();
export const clearWysiwygAtomSelectionEffect = StateEffect.define<null>();
export const startWysiwygCompositionGuardEffect = StateEffect.define<readonly SourceRange[]>();
export const endWysiwygCompositionGuardEffect = StateEffect.define<null>();

/**
 * G006 P1-4:EditorView 几何采集(visibleRanges)经此 effect 注入投影层。
 * 由 visibleRangesProbePlugin 在 viewportChanged 时派发;StateField 缓存并在
 * 全量重建时过滤 layoutDecorations(原子/保护范围保持全文)。
 */
export const setWysiwygVisibleRangesEffect = StateEffect.define<readonly SourceRange[]>();

/**
 * G006 P1-4 几何采集插件:视口变化时把 view.visibleRanges 注入投影层。
 * ranges 未变化时不派发(输入引起的文本移动若未改变可见区范围则跳过)。
 * 首次构造时立即派发一次,保证全量重建有可见区可用。
 */
export const visibleRangesProbePlugin = ViewPlugin.fromClass(
  class VisibleRangesProbe {
    #lastRanges: readonly SourceRange[] | null = null;

    constructor(view: EditorView) {
      this.#dispatch(view);
    }

    update(update: ViewUpdate) {
      if (update.viewportChanged || update.geometryChanged) {
        this.#dispatch(update.view);
      }
    }

    #dispatch(view: EditorView): void {
      const ranges = view.visibleRanges.map((range) =>
        Object.freeze({ from: range.from, to: range.to }),
      );
      if (this.#lastRanges !== null && rangesEqual(this.#lastRanges, ranges)) {
        return;
      }
      this.#lastRanges = ranges;
      view.dispatch({
        effects: setWysiwygVisibleRangesEffect.of(ranges),
        annotations: Transaction.addToHistory.of(false),
      });
    }
  },
);

/**
 * compositionend 后由 renderer 派发:强制投影全量重建一次。
 * composition 期间的输入事务只 map 不重建(见 isCompositionInputTransaction),
 * 该 effect 保证 IME 提交完成后装饰与最终文档一致。
 */
export const refreshWysiwygProjectionEffect = StateEffect.define<null>();
const clearWysiwygTypedBoundaryEffect = StateEffect.define<null>();

/** 编辑器失焦后清除刚输入边界，避免重新聚焦前继续显示 link/image 源码。 */
export const clearWysiwygTypedBoundaryOnBlur = EditorView.domEventHandlers({
  blur(_event, view) {
    // typedBoundary 已为空时不再派发空事务(失焦低频,避免无谓的 selection-delta 分支)。
    if (view.state.field(wysiwygProjectionField, false)?.typedBoundary !== null) {
      view.dispatch({ effects: clearWysiwygTypedBoundaryEffect.of(null) });
    }
    return false;
  },
});

export const wysiwygProjectionField = StateField.define<WysiwygProjectionState>({
  create(state) {
    return compileProjection(state, [], []);
  },
  update(previous, transaction) {
    const index = transaction.state.field(markdownRangeIndexField);
    const mode = transaction.state.field(editorModeField);
    // G006 P1-4:ViewPlugin 几何采集经 effect 注入;变化时触发限定重建。
    const visibleRangesEffect = transaction.effects.find((effect) =>
      effect.is(setWysiwygVisibleRangesEffect),
    );
    const nextVisibleRanges =
      visibleRangesEffect !== undefined
        ? freezeRanges(visibleRangesEffect.value)
        : previous.visibleRanges;
    if (
      visibleRangesEffect !== undefined &&
      !rangesEqual(nextVisibleRanges, previous.visibleRanges)
    ) {
      return compileProjection(
        transaction.state,
        previous.selectedAtomIds,
        previous.compositionGuardRanges,
        previous.typedBoundary,
        nextVisibleRanges,
      );
    }
    const selectedAtomIds = normalizeSelectedAtomIds(
      index,
      applyAtomEffects(previous.selectedAtomIds, transaction.effects),
      transaction.state.selection,
      transaction.state,
      previous.selectedAtomIds,
    );
    const compositionGuardRanges = applyCompositionEffects(
      previous.compositionGuardRanges,
      transaction.effects,
    );
    const mappedCompositionGuardRanges = transaction.docChanged
      ? mapCompositionGuardRanges(compositionGuardRanges, transaction)
      : compositionGuardRanges;
    const typedBoundary = computeTypedBoundary(previous.typedBoundary, transaction);
    const effectsChanged =
      selectedAtomIds !== previous.selectedAtomIds ||
      compositionGuardRanges !== previous.compositionGuardRanges ||
      transaction.effects.some((effect) => effect.is(setCodeBlockLineNumbersEffect));

    // G004 P0-2:compositionend 后由 renderer 派发空事务 + refresh effect,
    // 强制投影全量重建一次,保证 IME 提交后装饰与最终文档一致。
    if (transaction.effects.some((effect) => effect.is(refreshWysiwygProjectionEffect))) {
      return compileProjection(
        transaction.state,
        selectedAtomIds,
        mappedCompositionGuardRanges,
        typedBoundary,
        nextVisibleRanges,
      );
    }

    if (mode === "source") {
      if (
        previous.mode === "source" &&
        !transaction.docChanged &&
        index.version === previous.rangeIndexVersion
      ) {
        return previous;
      }
      return compileProjection(transaction.state, [], [], null, nextVisibleRanges);
    }

    if (mode !== previous.mode || effectsChanged) {
      return compileProjection(
        transaction.state,
        selectedAtomIds,
        mappedCompositionGuardRanges,
        typedBoundary,
        nextVisibleRanges,
      );
    }

    if (transaction.docChanged) {
      // G004 P0-2:composition 输入事务只 map 不重建(全量重建会取消输入法)。
      if (isCompositionInputTransaction(transaction)) {
        getWysiwygDiagnostics(transaction.state)?.recordCompositionMapSkip();
        return freezeProjectionState({
          ...previous,
          rangeIndexVersion: index.version,
          typedBoundary,
          compositionGuardRanges: mappedCompositionGuardRanges,
          layoutDecorations: previous.layoutDecorations.map(transaction.changes),
          atomicRanges: previous.atomicRanges.map(transaction.changes),
          protectedRanges: mapProtectedRanges(previous.protectedRanges, transaction.changes),
          lastSelectionDeltaIds: [],
        });
      }
      return updateDocumentProjection(
        previous,
        transaction,
        index,
        selectedAtomIds,
        mappedCompositionGuardRanges,
        typedBoundary,
      );
    }

    if (index.version !== previous.rangeIndexVersion) {
      return compileProjection(
        transaction.state,
        selectedAtomIds,
        mappedCompositionGuardRanges,
        typedBoundary,
        nextVisibleRanges,
      );
    }

    if (!transaction.selection && typedBoundary === previous.typedBoundary) {
      return previous;
    }

    const activeSyntaxIds = collectActiveSyntaxIds(
      index,
      transaction.state.selection,
      typedBoundary,
    );
    const changedIds = symmetricDifference(previous.activeSyntaxIds, activeSyntaxIds);
    if (changedIds.length === 0) {
      return previous.lastSelectionDeltaIds.length === 0 && typedBoundary === previous.typedBoundary
        ? previous
        : freezeProjectionState({
            ...previous,
            typedBoundary,
            lastSelectionDeltaIds: [],
          });
    }

    getWysiwygDiagnostics(transaction.state)?.recordSelectionDeltaUpdate();
    const layoutDecorations = updateChangedLayoutDecorations(
      previous.layoutDecorations,
      index,
      changedIds,
      activeSyntaxIds,
      previous.selectedAtomIds,
      previous.compositionGuardRanges,
      transaction.state,
    );
    const atomicRanges = updateChangedAtomicRanges(
      previous.atomicRanges,
      index,
      changedIds,
      activeSyntaxIds,
      previous.selectedAtomIds,
      transaction.state,
    );
    // 表格的 protected 范围依赖 active 状态（非活动整表、活动仅 delimiter 行），
    // selection 变化同样会改变该集合，必须在此同步重算。
    const protectedRanges = changedIds.some((id) => index.get(id)?.kind === "table")
      ? buildProtectedRanges(index, activeSyntaxIds, transaction.state)
      : previous.protectedRanges;
    return freezeProjectionState({
      ...previous,
      typedBoundary,
      activeSyntaxIds,
      layoutDecorations,
      atomicRanges,
      protectedRanges,
      lastSelectionDeltaIds: changedIds,
    });
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (projection) => projection.layoutDecorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).atomicRanges),
    ];
  },
});

export function configureWysiwygProjectionFeatures(
  features: readonly WysiwygProjectionFeature[],
): Extension {
  return configuredProjectionFeatures.of(Object.freeze([...features]));
}

export function hasWysiwygProjectionFeature(
  state: EditorState,
  feature: WysiwygProjectionFeature,
): boolean {
  return state.facet(configuredProjectionFeatures).includes(feature);
}

export function inspectWysiwygProjection(state: EditorState): WysiwygProjectionSnapshot {
  const projection = state.field(wysiwygProjectionField);
  return Object.freeze({
    mode: projection.mode,
    rangeIndexVersion: projection.rangeIndexVersion,
    activeSyntaxIds: projection.activeSyntaxIds,
    selectedAtomIds: projection.selectedAtomIds,
    compositionGuardRanges: projection.compositionGuardRanges,
    protectedRanges: projection.protectedRanges,
    layoutDecorationCount: projection.layoutDecorations.size,
    atomicRangeCount: projection.atomicRanges.size,
    lastSelectionDeltaIds: projection.lastSelectionDeltaIds,
  });
}

function compileProjection(
  state: EditorState,
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  typedBoundary: number | null = null,
  visibleRanges: readonly SourceRange[] = [],
): WysiwygProjectionState {
  const index = state.field(markdownRangeIndexField);
  if (state.field(editorModeField) === "source") {
    return freezeProjectionState({
      mode: "source",
      rangeIndexVersion: index.version,
      activeSyntaxIds: [],
      selectedAtomIds: [],
      compositionGuardRanges: [],
      protectedRanges: [],
      layoutDecorations: Decoration.none,
      atomicRanges: Decoration.none,
      lastSelectionDeltaIds: [],
      typedBoundary: null,
      visibleRanges,
    });
  }

  const activeSyntaxIds = collectActiveSyntaxIds(index, state.selection, typedBoundary);
  const normalizedAtomIds = sortStrings(selectedAtomIds.filter((id) => index.get(id) !== null));
  const normalizedGuards = freezeRanges(compositionGuardRanges);
  const layoutDecorations = buildLayoutDecorations(
    index,
    activeSyntaxIds,
    normalizedAtomIds,
    normalizedGuards,
    state,
    visibleRanges,
  );
  const atomicRanges = buildAtomicRanges(index, activeSyntaxIds, normalizedAtomIds, state);
  const protectedRanges = buildProtectedRanges(index, activeSyntaxIds, state);
  const diagnostics = getWysiwygDiagnostics(state);
  diagnostics?.recordLayoutDecorationReplace();
  diagnostics?.recordFullProjectionBuild();
  if (visibleRanges.length > 0) {
    diagnostics?.recordVisibleRangeLimitedBuild();
  }
  return freezeProjectionState({
    mode: "wysiwyg",
    rangeIndexVersion: index.version,
    activeSyntaxIds,
    selectedAtomIds: normalizedAtomIds,
    compositionGuardRanges: normalizedGuards,
    protectedRanges,
    layoutDecorations,
    atomicRanges,
    lastSelectionDeltaIds: [],
    typedBoundary,
    visibleRanges,
  });
}

function updateDocumentProjection(
  previous: WysiwygProjectionState,
  transaction: Transaction,
  index: MarkdownRangeIndex,
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  typedBoundary: number | null,
): WysiwygProjectionState {
  const activeSyntaxIds = collectActiveSyntaxIds(index, transaction.state.selection, typedBoundary);

  // G004 P0-1 纯文本输入快速路径:
  // 纯字母/数字插入且光标前后都在纯文本段落(无任何记录重叠)时,装饰不可能变化,
  // 直接 map 保留全部装饰 DOM,跳过 collectChangedRecordIds 的两次全量遍历。
  if (plainTextInsertCanMapProjection(transaction, index)) {
    getWysiwygDiagnostics(transaction.state)?.recordProjectionMapSkip();
    return freezeProjectionState({
      ...previous,
      rangeIndexVersion: index.version,
      activeSyntaxIds,
      typedBoundary,
      layoutDecorations: previous.layoutDecorations.map(transaction.changes),
      atomicRanges: previous.atomicRanges.map(transaction.changes),
      protectedRanges: mapProtectedRanges(previous.protectedRanges, transaction.changes),
      lastSelectionDeltaIds: [],
    });
  }

  const previousIndex = transaction.startState.field(markdownRangeIndexField);
  const changedIds = collectChangedRecordIds(
    previousIndex,
    index,
    previous.activeSyntaxIds,
    activeSyntaxIds,
  );
  const layoutDecorations = updateChangedLayoutDecorations(
    previous.layoutDecorations.map(transaction.changes),
    index,
    changedIds,
    activeSyntaxIds,
    selectedAtomIds,
    compositionGuardRanges,
    transaction.state,
  );
  const atomicRanges = updateChangedAtomicRanges(
    previous.atomicRanges.map(transaction.changes),
    index,
    changedIds,
    activeSyntaxIds,
    selectedAtomIds,
    transaction.state,
  );
  const dirtyCodeBlockCount = countDirtyCodeBlocks(previousIndex, index);
  if (dirtyCodeBlockCount > 0) {
    getWysiwygDiagnostics(transaction.state)?.recordDirtyCodeBlockRebuild(dirtyCodeBlockCount);
  }
  return freezeProjectionState({
    mode: "wysiwyg",
    rangeIndexVersion: index.version,
    activeSyntaxIds,
    selectedAtomIds,
    compositionGuardRanges,
    protectedRanges: buildProtectedRanges(index, activeSyntaxIds, transaction.state),
    layoutDecorations,
    atomicRanges,
    lastSelectionDeltaIds: [],
    typedBoundary,
    visibleRanges: previous.visibleRanges,
  });
}

/**
 * G004 P0-1 快速路径判定:事务是否"只插入纯文本"(字母/组合标记/数字,无结构字符)。
 * 判定条件:fromA === toA(纯插入)且插入内容只含 \p{L}\p{M}\p{N}——
 * `*`/`#`/`` ` ``/`[` 等可能产生新语法结构的字符被排除。
 */
function transactionOnlyInsertsPlainText(transaction: Transaction): boolean {
  if (!transaction.docChanged || transaction.reconfigured) {
    return false;
  }
  if (!transaction.isUserEvent("input")) {
    return false;
  }
  let plainInsertion = true;
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (fromA !== toA || !isPlainTextInput(inserted.toString())) {
      plainInsertion = false;
    }
  });
  return plainInsertion;
}

/**
 * G004 P0-1 完整判定:纯文本插入 + 单光标空选区 + 输入前后光标都在"纯文本段落"
 * (光标处无任何 record 重叠——纯文本段落没有语法记录)。
 */
function plainTextInsertCanMapProjection(
  transaction: Transaction,
  index: MarkdownRangeIndex,
): boolean {
  if (!transactionOnlyInsertsPlainText(transaction)) {
    return false;
  }
  const before = transaction.startState.selection.main;
  const after = transaction.state.selection.main;
  if (!before.empty || !after.empty) {
    return false;
  }
  if (transaction.startState.selection.ranges.length !== 1) {
    return false;
  }
  if (transaction.state.selection.ranges.length !== 1) {
    return false;
  }
  const previousIndex = transaction.startState.field(markdownRangeIndexField);
  return (
    cursorInPlainParagraph(previousIndex, before.head) &&
    cursorInPlainParagraph(index, after.head) &&
    // 三审发现:结构记录前的纯文本插入会让后续 record 因绝对偏移获得新 ID
    // (link:2:13 → link:3:14),而 map 后的 decoration 仍携带旧 wysiwygRecordId,
    // 导致 selection delta 无法按新 ID 清理旧装饰。快速路径只允许 record ID
    // 集合完全稳定的场景,任何 ID 变化都回退正常增量重建。
    recordIdsStable(previousIndex, index)
  );
}

/** 事务前后所有 record ID 完全一致(结构记录未被前方插入改变绝对位置) */
export function recordIdsStable(
  previousIndex: MarkdownRangeIndex,
  index: MarkdownRangeIndex,
): boolean {
  const previousIds = new Set(previousIndex.records.map((record) => record.id));
  if (previousIds.size !== index.records.length) {
    return false;
  }
  for (const record of index.records) {
    if (!previousIds.has(record.id)) {
      return false;
    }
  }
  return true;
}

/** 光标所在位置无任何语法记录重叠 = 纯文本段落 */
function cursorInPlainParagraph(index: MarkdownRangeIndex, position: number): boolean {
  return index.overlapping(position, position).length === 0;
}

/** G004 P0-2 composition 输入事务判定(CM6 IME 事务 userEvent 为 "input.type.compose") */
function isCompositionInputTransaction(transaction: Transaction): boolean {
  return transaction.docChanged && transaction.isUserEvent("input.type.compose");
}

function collectChangedRecordIds(
  previousIndex: MarkdownRangeIndex,
  index: MarkdownRangeIndex,
  previousActiveIds: readonly string[],
  activeIds: readonly string[],
): readonly string[] {
  const ids = new Set<string>(symmetricDifference(previousActiveIds, activeIds));
  for (const record of previousIndex.records) {
    if (!index.get(record.id)) {
      ids.add(record.id);
    }
  }
  for (const record of index.records) {
    if (!previousIndex.get(record.id)) {
      ids.add(record.id);
    }
  }
  return Object.freeze([...ids]);
}

function countDirtyCodeBlocks(
  previousIndex: MarkdownRangeIndex,
  index: MarkdownRangeIndex,
): number {
  const removed = previousIndex.records.filter(
    (record) => record.kind === "deferred-code" && !index.get(record.id),
  ).length;
  const added = index.records.filter(
    (record) => record.kind === "deferred-code" && !previousIndex.get(record.id),
  ).length;
  return Math.max(removed, added);
}

function collectActiveSyntaxIds(
  index: MarkdownRangeIndex,
  selection: EditorSelection,
  typedBoundary: number | null,
): readonly string[] {
  const activeIds = new Set<string>();
  for (const range of selection.ranges) {
    for (const record of index.overlapping(range.from, range.to)) {
      if (selectionActivatesRecord(record, range.from, range.to, typedBoundary)) {
        activeIds.add(record.id);
      }
    }
  }
  return sortStrings(activeIds);
}

function buildLayoutDecorations(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
  visibleRanges: readonly SourceRange[] = [],
): DecorationSet {
  // G006 P1-4:全量重建时按最近可见区过滤 records——与任一可见区相交即完整
  // 构建(装饰 range 不裁剪,整块 widget 天然不可截断);无可见区信息则全文。
  const records =
    visibleRanges.length > 0
      ? index.records.filter((record) =>
          visibleRanges.some(
            (range) => range.from < record.fullRange.to && record.fullRange.from < range.to,
          ),
        )
      : index.records;
  const ranges = records.flatMap((record) =>
    buildLayoutDecorationsForRecord(
      record,
      activeSyntaxIds,
      selectedAtomIds,
      compositionGuardRanges,
      state,
    ),
  );
  return Decoration.set(ranges, true);
}

function updateChangedLayoutDecorations(
  previous: DecorationSet,
  index: MarkdownRangeIndex,
  changedIds: readonly string[],
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): DecorationSet {
  const changed = new Set(changedIds);
  const additions = changedIds.flatMap((id) => {
    const record = index.get(id);
    return record
      ? buildLayoutDecorationsForRecord(
          record,
          activeSyntaxIds,
          selectedAtomIds,
          compositionGuardRanges,
          state,
        )
      : [];
  });
  return previous.update({
    filter: (_from, _to, value) => !changed.has(String(value.spec.wysiwygRecordId ?? "")),
    add: additions,
    sort: true,
  });
}

function buildLayoutDecorationsForRecord(
  record: MarkdownRangeRecord,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  compositionGuardRanges: readonly SourceRange[],
  state: EditorState,
): readonly Range<Decoration>[] {
  if (hasWysiwygProjectionFeature(state, "frontmatter") && record.kind === "frontmatter") {
    return buildFrontmatterLayoutDecorations(record, state);
  }
  if (
    hasWysiwygProjectionFeature(state, "default-atoms") &&
    record.renderPolicy === "source-only-atom"
  ) {
    return buildDefaultAtomLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  if (
    hasWysiwygProjectionFeature(state, "headings") &&
    (record.kind === "heading-atx" || record.kind === "heading-setext")
  ) {
    return buildHeadingLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      compositionGuardRanges,
    );
  }
  if (
    hasWysiwygProjectionFeature(state, "blocks") &&
    (record.kind === "quote" ||
      record.kind === "list-item-unordered" ||
      record.kind === "list-item-ordered" ||
      record.kind === "task")
  ) {
    return buildBlockLayoutDecorations(record, state);
  }
  if (hasWysiwygProjectionFeature(state, "blocks") && record.kind === "deferred-code") {
    return buildCodeBlockLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      state.field(codeBlockLineNumbersField),
      state,
    );
  }
  if (hasWysiwygProjectionFeature(state, "tables") && isProjectableTable(record)) {
    return buildTableLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      selectedAtomIds.includes(record.id),
      state,
    );
  }
  if (hasWysiwygProjectionFeature(state, "html") && isProjectableHtml(record)) {
    return buildHtmlLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  if (hasWysiwygProjectionFeature(state, "mdx") && isProjectableMdx(record)) {
    return buildMdxLayoutDecorations(record, selectedAtomIds.includes(record.id), state);
  }
  if (
    (record.kind === "link" && hasWysiwygProjectionFeature(state, "links")) ||
    (record.kind === "image" && hasWysiwygProjectionFeature(state, "images")) ||
    (record.kind === "thematic-break" && hasWysiwygProjectionFeature(state, "thematic-breaks"))
  ) {
    return buildLinkMediaLayoutDecorations(
      record,
      activeSyntaxIds.includes(record.id),
      selectedAtomIds.includes(record.id),
      state,
    );
  }
  return [];
}

function buildAtomicRanges(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  state: EditorState,
): DecorationSet {
  const ranges = index.records.flatMap((record) =>
    buildAtomicRangesForRecord(record, activeSyntaxIds, selectedAtomIds, state),
  );
  return Decoration.set(ranges, true);
}

function updateChangedAtomicRanges(
  previous: DecorationSet,
  index: MarkdownRangeIndex,
  changedIds: readonly string[],
  activeSyntaxIds: readonly string[],
  selectedAtomIds: readonly string[],
  state: EditorState,
): DecorationSet {
  const changed = new Set(changedIds);
  const additions = changedIds.flatMap((id) => {
    const record = index.get(id);
    if (!record) {
      return [];
    }
    return buildAtomicRangesForRecord(record, activeSyntaxIds, selectedAtomIds, state);
  });
  return previous.update({
    filter: (_from, _to, value) => !changed.has(String(value.spec.wysiwygRecordId ?? "")),
    add: additions,
    sort: true,
  });
}

function buildAtomicRangesForRecord(
  record: MarkdownRangeRecord,
  activeSyntaxIds: readonly string[],
  _selectedAtomIds: readonly string[],
  state: EditorState,
): readonly Range<Decoration>[] {
  if (hasWysiwygProjectionFeature(state, "frontmatter") && record.kind === "frontmatter") {
    return buildFrontmatterAtomicRanges(record, state);
  }
  if (
    hasWysiwygProjectionFeature(state, "default-atoms") &&
    record.renderPolicy === "source-only-atom"
  ) {
    return buildDefaultAtomAtomicRanges(record, state);
  }
  if (
    hasWysiwygProjectionFeature(state, "blocks") &&
    (record.kind === "quote" ||
      record.kind === "list-item-unordered" ||
      record.kind === "list-item-ordered" ||
      record.kind === "task")
  ) {
    return buildBlockAtomicRanges(record, state);
  }
  if (hasWysiwygProjectionFeature(state, "blocks") && record.kind === "deferred-code") {
    return buildCodeBlockAtomicRanges(record, state);
  }
  if (hasWysiwygProjectionFeature(state, "tables") && isProjectableTable(record)) {
    return buildTableAtomicRanges(record, activeSyntaxIds.includes(record.id));
  }
  if (hasWysiwygProjectionFeature(state, "html") && isProjectableHtml(record)) {
    return buildHtmlAtomicRanges(record, _selectedAtomIds.includes(record.id));
  }
  if (hasWysiwygProjectionFeature(state, "mdx") && isProjectableMdx(record)) {
    return buildMdxAtomicRanges(record);
  }
  if (
    (record.kind === "link" && hasWysiwygProjectionFeature(state, "links")) ||
    (record.kind === "image" && hasWysiwygProjectionFeature(state, "images")) ||
    (record.kind === "thematic-break" && hasWysiwygProjectionFeature(state, "thematic-breaks"))
  ) {
    return buildLinkMediaAtomicRanges(record, activeSyntaxIds.includes(record.id));
  }
  return [];
}

function buildProtectedRanges(
  index: MarkdownRangeIndex,
  activeSyntaxIds: readonly string[],
  state: EditorState,
): readonly ProtectedSourceRange[] {
  return freezeRanges(
    index.records.flatMap((record) => {
      const ranges: ProtectedSourceRange[] = [];
      if (
        hasWysiwygProjectionFeature(state, "default-atoms") &&
        isRenderableDefaultAtom(record, state)
      ) {
        ranges.push({ ...record.fullRange, kind: "default-atom" });
      }
      if (hasWysiwygProjectionFeature(state, "frontmatter") && record.kind === "frontmatter") {
        ranges.push(
          ...getFrontmatterProtectedRanges(record, state).map((range) => ({
            ...range,
            kind: "frontmatter" as const,
          })),
        );
      }
      if (hasWysiwygProjectionFeature(state, "blocks")) {
        ranges.push(
          ...getBlockProtectedRanges(record, state).map((range) => ({
            ...range,
            kind: "block-marker" as const,
          })),
        );
        ranges.push(
          ...getCodeBlockProtectedRanges(record).map((range) => ({
            ...range,
            kind: "code" as const,
          })),
        );
      }
      if (hasWysiwygProjectionFeature(state, "tables") && isProjectableTable(record)) {
        ranges.push(
          ...getTableProtectedRanges(record, activeSyntaxIds.includes(record.id)).map((range) => ({
            ...range,
            kind: "table" as const,
          })),
        );
      }
      if (hasWysiwygProjectionFeature(state, "html") && isProjectableHtml(record)) {
        ranges.push(
          ...getHtmlProtectedRanges(record).map((range) => ({
            ...range,
            kind: "html" as const,
          })),
        );
      }
      if (hasWysiwygProjectionFeature(state, "mdx") && isProjectableMdx(record)) {
        ranges.push(
          ...getMdxProtectedRanges(record).map((range) => ({
            ...range,
            kind: "mdx" as const,
          })),
        );
      }
      return ranges;
    }),
  );
}

function applyAtomEffects(
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

function normalizeSelectedAtomIds(
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

function applyCompositionEffects(
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
function computeTypedBoundary(previous: number | null, transaction: Transaction): number | null {
  if (transaction.effects.some((effect) => effect.is(clearWysiwygTypedBoundaryEffect))) {
    return null;
  }
  if (
    transaction.docChanged &&
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

function mapCompositionGuardRanges(
  ranges: readonly SourceRange[],
  transaction: { readonly changes: { mapPos(position: number, association?: number): number } },
): readonly SourceRange[] {
  if (ranges.length === 0) {
    return ranges;
  }
  return freezeRanges(
    ranges.map((range) => ({
      from: transaction.changes.mapPos(range.from, -1),
      to: transaction.changes.mapPos(range.to, 1),
    })),
  );
}

/** G004 P0-1 快速路径用:protected 范围整体映射到新文档(字段保留,仅 from/to 重定位) */
function mapProtectedRanges(
  ranges: readonly ProtectedSourceRange[],
  changes: { mapPos(position: number, association?: number): number },
): readonly ProtectedSourceRange[] {
  if (ranges.length === 0) {
    return ranges;
  }
  return freezeRanges(
    ranges.map((range) => ({
      ...range,
      from: changes.mapPos(range.from, -1),
      to: changes.mapPos(range.to, 1),
    })),
  );
}

function symmetricDifference(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return Object.freeze([
    ...previous.filter((id) => !nextSet.has(id)),
    ...next.filter((id) => !previousSet.has(id)),
  ]);
}

function freezeProjectionState(state: WysiwygProjectionState): WysiwygProjectionState {
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

function freezeRanges<T extends SourceRange>(ranges: readonly T[]): readonly T[] {
  if (Object.isFrozen(ranges) && ranges.every((range) => Object.isFrozen(range))) {
    return ranges;
  }
  return Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
}

function rangesEqual(left: readonly SourceRange[], right: readonly SourceRange[]): boolean {
  return (
    left.length === right.length &&
    left.every((range, index) => range.from === right[index]?.from && range.to === right[index]?.to)
  );
}

function freezeStrings(values: readonly string[]): readonly string[] {
  return Object.isFrozen(values) ? values : Object.freeze([...values]);
}

function sortStrings(values: Iterable<string>): readonly string[] {
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

function selectionActivatesRecord(
  record: MarkdownRangeRecord,
  from: number,
  to: number,
  typedBoundary: number | null,
): boolean {
  if (record.kind === "frontmatter") {
    return false;
  }
  if (
    record.interactionPolicy === "structured-block" &&
    (record.kind === "table" || record.kind === "html")
  ) {
    // 结构化块始终显示 widget，不因光标/选区进入而切换到源码态。
    return false;
  }
  if (record.interactionPolicy !== "reveal-source") {
    return true;
  }
  if (from === to) {
    // G004 P0-3 typedBoundary 宽松判定:刚由输入事务产生的光标恰好落在
    // reveal-source 记录(link/image)闭合符右缘时,保持 reveal 一瞬间,
    // 避免"刚打完 [text](url) 的 ) 立即收起"的视觉跳动。
    if (typedBoundary !== null && from === typedBoundary && record.fullRange.to === typedBoundary) {
      return true;
    }
    return from > record.fullRange.from && from < record.fullRange.to;
  }
  return from < record.fullRange.to && to > record.fullRange.from;
}
