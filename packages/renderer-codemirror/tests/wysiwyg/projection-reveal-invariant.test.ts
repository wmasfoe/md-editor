/**
 * T-26 / AC-11：显形点集的**不变量矩阵**。
 *
 * 每步事务后断言：`inspectWysiwygProjection(state).inlineMarkerRevealIds`
 * 恒等于 `resolveInlineMarkerRevealIds(index, selection, showSourceMarkers)` 的重算结果。
 *
 * 该矩阵只检测“陈旧”，不检测语义正确（语义由 L1 的 T-4…T-17 锁定）。
 * 价值：未来任何新增的 return 路径若漏写显形点集，**即使 `...previous` 展开让 typecheck
 * 通过**，本矩阵也会红。
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../../src/mode.ts";
import {
  inlineStyleMarkersField,
  setInlineStyleMarkersEffect,
} from "../../src/wysiwyg/projections/inline-heading.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";
import { resolveInlineMarkerRevealIds } from "../../src/wysiwyg/state/inline-marker-reveal.ts";

const DOC = "Head\n\nxx **bold** yy plain tail\n";

function createHarness(doc = DOC) {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["inline-styles", "headings"]),
      wysiwygProjectionField,
      inlineStyleMarkersField,
    ],
  });
  return { state, diagnostics };
}

/**
 * 注意：record id 内含绝对偏移（`bold:from:to:hash`），文档变更后必须**重新取**，
 * 否则断言会拿旧 id 与新状态比对（这是本矩阵早期的自身缺陷）。
 */
function boldOf(state: EditorState) {
  const record = state.field(markdownRangeIndexField).byKind("bold")[0];
  expect(record).toBeDefined();
  return record!;
}

function snapshotRevealIds(state: EditorState): readonly string[] {
  return inspectWysiwygProjection(state).inlineMarkerRevealIds;
}

function recomputedRevealIds(state: EditorState): readonly string[] {
  // 与投影层一致：source 模式下由 `compileProjection` 显式传 `EMPTY_REVEAL_IDS`，
  // resolver 本身不接收 mode（见 PRD Step 1.2 / F6）。
  if (state.field(editorModeField) === "source") {
    return [];
  }
  return resolveInlineMarkerRevealIds(
    state.field(markdownRangeIndexField),
    state.selection,
    state.field(inlineStyleMarkersField, false) ?? false,
  );
}

function expectInvariant(state: EditorState): void {
  expect([...snapshotRevealIds(state)].toSorted()).toEqual(
    [...recomputedRevealIds(state)].toSorted(),
  );
}

function apply(state: EditorState, spec: TransactionSpec): EditorState {
  return state.update(spec).state;
}

describe("T-26 显形点集不变量矩阵", () => {
  it("累计序列：纯文本 / 记录内 / 贴边 / 移出 / 选区贴边 / 开关 / 模式 全部保持一致", () => {
    const harness = createHarness();
    let state = harness.state;
    const diagnostics = harness.diagnostics;
    expectInvariant(state);

    // 行 1：在**文档尾部**纯文本插入。
    //
    // 必须在尾部：record id 内嵌绝对偏移，前面插入会让后续记录 id 变化 ⇒
    // `recordIdsStable()` 为 false ⇒ 走增量路径而不是快速路径。尾部插入才能命中
    // `plainTextInsertCanMapProjection`（`:351`），这也是本行声明要覆盖的路径。
    const fastPathBefore = diagnostics.snapshot().projectionMapSkipCount;
    const tail = state.doc.length;
    state = apply(state, {
      changes: { from: tail, insert: "abc" },
      selection: EditorSelection.single(tail + 3),
      userEvent: "input.type",
    });
    expect(diagnostics.snapshot().projectionMapSkipCount).toBe(fastPathBefore + 1);
    expect(snapshotRevealIds(state)).toHaveLength(0);
    expectInvariant(state);

    // 行 2：折叠光标进入记录内部（active 变化 ⇒ changedIds 非空 ⇒ 全量选区分支 :232）。
    let bold = boldOf(state);
    state = apply(state, { selection: EditorSelection.single(bold.fullRange.from + 3) });
    expect(snapshotRevealIds(state)).toContain(bold.id);
    expectInvariant(state);

    // 行 3：在记录内部移动到 fullRange.from（active 不变、reveal 不变、delta 非空 ⇒ :202）。
    bold = boldOf(state);
    const beforeFreeze = diagnostics.snapshot().selectionFreezeWithoutDeltaCount;
    const previousProjection = state.field(wysiwygProjectionField);
    state = apply(state, { selection: EditorSelection.single(bold.fullRange.from) });
    expect(state.field(wysiwygProjectionField)).not.toBe(previousProjection);
    expect(snapshotRevealIds(state)).toContain(bold.id);
    expect(diagnostics.snapshot().selectionFreezeWithoutDeltaCount).toBeGreaterThan(beforeFreeze);

    // 行 4：移到无关纯文本（active 变化 ⇒ :232），reveal 清空。
    state = apply(state, { selection: EditorSelection.single(2) });
    expect(snapshotRevealIds(state)).toHaveLength(0);
    expectInvariant(state);

    // 行 5：范围选区贴住记录左缘（零重叠）⇒ 必须入选，且再次命中 :202。
    bold = boldOf(state);
    const beforeTouch = diagnostics.snapshot().selectionFreezeWithoutDeltaCount;
    state = apply(state, {
      selection: EditorSelection.single(bold.fullRange.from - 2, bold.fullRange.from),
    });
    expect(snapshotRevealIds(state)).toContain(bold.id);
    expect(diagnostics.snapshot().selectionFreezeWithoutDeltaCount).toBeGreaterThan(beforeTouch);
    expectInvariant(state);

    // 行 6：开关 ON ⇒ 冻结常数空集（同一引用），仍保持一致。
    state = apply(state, { effects: setInlineStyleMarkersEffect.of(true) });
    expect(snapshotRevealIds(state)).toHaveLength(0);
    expectInvariant(state);

    // 行 7：开关 OFF ⇒ 立即恢复当期点集。
    bold = boldOf(state);
    state = apply(state, { effects: setInlineStyleMarkersEffect.of(false) });
    expect(snapshotRevealIds(state)).toContain(bold.id);
    expectInvariant(state);

    // 行 8/9：source 模式恒为空集，切回后恢复。
    state = apply(state, { effects: setEditorModeEffect.of("source") });
    expect(state.field(editorModeField)).toBe("source");
    expect(snapshotRevealIds(state)).toHaveLength(0);
    expectInvariant(state);

    bold = boldOf(state);
    state = apply(state, { effects: setEditorModeEffect.of("wysiwyg") });
    expect(snapshotRevealIds(state)).toContain(bold.id);
    expectInvariant(state);

    // 行 10：文档替换（增量路径）后仍保持一致。
    state = apply(state, {
      changes: { from: state.doc.length, insert: "\n\nmore **tail** text\n" },
    });
    expectInvariant(state);
  });

  it("隔离序列：fresh 状态单次拖选贴边命中 :200 比较臂（reveal 更新且身份变化）", () => {
    const harness = createHarness();
    const bold = boldOf(harness.state);
    const diagnostics = harness.diagnostics;
    // fresh 状态：lastSelectionDeltaIds 为空、typedBoundary 为 null。
    const before = harness.state.field(wysiwygProjectionField);
    expect(snapshotRevealIds(harness.state)).toHaveLength(0);

    const state = apply(harness.state, {
      selection: EditorSelection.single(bold.fullRange.from - 2, bold.fullRange.from),
    });

    expect(state.field(wysiwygProjectionField)).not.toBe(before);
    expect(snapshotRevealIds(state)).toContain(bold.id);
    expectInvariant(state);
    // `:200` 不是 `:202`：计数不得增加。
    expect(diagnostics.snapshot().selectionFreezeWithoutDeltaCount).toBe(0);
  });

  it("无关事务（无 doc/selection/effect）不重建投影", () => {
    const harness = createHarness();
    const before = harness.state.field(wysiwygProjectionField);
    const after = harness.state.update({ effects: [] }).state;
    expect(after.field(wysiwygProjectionField)).toBe(before);
  });
});
