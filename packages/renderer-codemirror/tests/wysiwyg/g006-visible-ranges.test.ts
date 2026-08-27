import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import {
  markdownRangeIndexField,
  type MarkdownRangeIndex,
} from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  setWysiwygVisibleRangesEffect,
  wysiwygProjectionField,
} from "../../src/../src/wysiwyg/projection-state.ts";
import type { SourceRange } from "../../src/markdown/range-types.ts";

function createHarness(doc: string): { state: EditorState; diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures([
        "inline-styles",
        "headings",
        "blocks",
        "links",
        "images",
        "thematic-breaks",
        "default-atoms",
        "frontmatter",
        "tables",
        "html",
        "mdx",
      ]),
      wysiwygProjectionField,
    ],
  });
  return { state, diagnostics };
}

/** 派发可见区 effect,返回应用后的 state(显式访问 .state 触发 StateField 惰性求值) */
function applyVisibleRanges(state: EditorState, ranges: readonly SourceRange[]): EditorState {
  const transaction = state.update({
    effects: setWysiwygVisibleRangesEffect.of(ranges),
    annotations: Transaction.addToHistory.of(false),
  });
  void transaction.state;
  return transaction.state;
}

function decoratedRecordIds(state: EditorState): readonly string[] {
  const ids = new Set<string>();
  state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, state.doc.length, (_from, _to, value) => {
      const id = String(value.spec.wysiwygRecordId ?? "");
      if (id) ids.add(id);
    });
  return [...ids];
}

function atomicRecordIds(state: EditorState): readonly string[] {
  const ids = new Set<string>();
  state
    .field(wysiwygProjectionField)
    .atomicRanges.between(0, state.doc.length, (_from, _to, value) => {
      const id = String(value.spec.wysiwygRecordId ?? "");
      if (id) ids.add(id);
    });
  return [...ids];
}

function kindOf(index: MarkdownRangeIndex, id: string): string {
  return index.get(id)?.kind ?? "?";
}

describe("G006 P1-4 visibleRanges 限定全量重建", () => {
  // 每行一个 ATX heading:全文 2000 个可投影记录,可见区只有 ~3 个
  const headingLines = Array.from(
    { length: 2000 },
    (_unused, index) => `# Line ${index} content`,
  ).join("\n");

  it("C1: 全量重建只构建与可见区相交的行内记录", () => {
    const { state } = createHarness(headingLines);
    const visible = applyVisibleRanges(state, [{ from: 1000, to: 1100 }]);
    const index = visible.field(markdownRangeIndexField);

    const decorated = decoratedRecordIds(visible);
    expect(decorated.length).toBeGreaterThan(0);
    // 所有装饰记录都必须与可见区相交(record 存在且 fullRange 与 [1000,1100] 重叠)
    const invalid = decorated
      .map((id) => index.get(id))
      .filter(
        (record) =>
          record === null || !(record.fullRange.from < 1100 && 1000 < record.fullRange.to),
      );
    expect(invalid).toEqual([]);
    // 全文 records 远大于可见区装饰数(过滤生效)
    expect(decorated.length).toBeLessThan(index.records.length / 2);
  });

  it("C2: 整块 widget 与可见区重叠即完整重建(不可截断)", () => {
    const doc = [
      "Before",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
      "",
      "After",
      "",
    ].join("\n");
    const { state } = createHarness(doc);
    const index = state.field(markdownRangeIndexField);
    const table = index.records.find((record) => record.kind === "table");
    if (!table) {
      throw new Error("Expected a table record.");
    }
    // 可见区只覆盖表格的中间部分
    const partial = { from: table.fullRange.from + 2, to: table.fullRange.to - 2 };
    const visible = applyVisibleRanges(state, [partial]);

    const decorated = decoratedRecordIds(visible);
    expect(decorated).toContain(table.id);
    // 表格装饰覆盖完整 fullRange(未被截断):存在以 table 全宽为界的装饰
    let coversFull = false;
    visible
      .field(wysiwygProjectionField)
      .layoutDecorations.between(0, visible.doc.length, (from, to, value) => {
        if (String(value.spec.wysiwygRecordId ?? "") === table.id) {
          if (from <= table.fullRange.from && to >= table.fullRange.to) {
            coversFull = true;
          }
        }
      });
    expect(coversFull).toBe(true);
  });

  it("C3: 可见区变化触发重建,相同 ranges 不重建", () => {
    const { state, diagnostics } = createHarness(headingLines);

    const first = applyVisibleRanges(state, [{ from: 0, to: 60 }]);
    const firstIds = decoratedRecordIds(first);
    const buildsAfterFirst = diagnostics.snapshot().fullProjectionBuildCount;

    // 相同 ranges → 不重建
    const same = applyVisibleRanges(first, [{ from: 0, to: 60 }]);
    expect(diagnostics.snapshot().fullProjectionBuildCount).toBe(buildsAfterFirst);

    // 变化 → 重建,新可见区装饰出现
    const moved = applyVisibleRanges(same, [{ from: 80, to: 140 }]);
    expect(diagnostics.snapshot().fullProjectionBuildCount).toBeGreaterThan(buildsAfterFirst);
    const movedIds = decoratedRecordIds(moved);
    expect(movedIds.length).toBeGreaterThan(0);
    expect(movedIds).not.toEqual(firstIds);
  });

  it("C4: atomic 与 protected 在可见区限定下仍覆盖全文", () => {
    const doc = ["**bold**", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "After", ""].join(
      "\n",
    );
    const { state } = createHarness(doc);
    const index = state.field(markdownRangeIndexField);
    const allIds = index.records.map((record) => record.id);
    // 可见区只覆盖文档开头
    const visible = applyVisibleRanges(state, [{ from: 0, to: 10 }]);

    // atomic 覆盖全文(表格在可见区外也有原子装饰)
    const atomic = atomicRecordIds(visible);
    const tableId = allIds.find((id) => kindOf(index, id) === "table");
    expect(tableId).toBeDefined();
    expect(atomic).toContain(tableId);
    // protected 覆盖全文
    const projection = inspectWysiwygProjection(visible);
    expect(projection.protectedRanges.length).toBeGreaterThan(0);
    expect(projection.protectedRanges.some((range) => range.kind === "table")).toBe(true);
  });

  it("C5: 纯文本输入快速路径不受可见区限定影响", () => {
    const lines = Array.from({ length: 200 }, (_unused, index) => `Line ${index} content`).join(
      "\n",
    );
    const { state, diagnostics } = createHarness(lines);
    const visible = applyVisibleRanges(state, [{ from: 0, to: 60 }]);
    const before = diagnostics.snapshot().projectionMapSkipCount;

    const positioned = visible.update({ selection: EditorSelection.cursor(5) }).state;
    const typed = positioned.update({
      changes: { from: 5, insert: "x" },
      selection: EditorSelection.cursor(6),
      userEvent: "input.type",
    });
    void typed.state;
    expect(diagnostics.snapshot().projectionMapSkipCount).toBe(before + 1);
  });

  it("性能:可见区构建的装饰数远小于全文", () => {
    const { state } = createHarness(headingLines);
    const full = inspectWysiwygProjection(state).layoutDecorationCount;
    const visible = applyVisibleRanges(state, [{ from: 1000, to: 1100 }]);
    const limited = inspectWysiwygProjection(visible).layoutDecorationCount;
    // 2000 行可见 ~3 行:限定构建应缩减到全文的 10% 以下
    expect(full).toBeGreaterThan(0);
    expect(limited).toBeLessThan(full / 10);
  });
});
