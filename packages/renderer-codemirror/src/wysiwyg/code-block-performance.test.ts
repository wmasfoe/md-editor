import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  provideWysiwygDiagnostics,
  WysiwygDiagnostics,
  type WysiwygDiagnosticsSnapshot,
} from "../diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { getM2CodeBlockPerformanceFixture } from "../markdown/fixtures.ts";
import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
  type MarkdownRangeIndex,
} from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";
import { editorModeField } from "../mode.ts";
import { codeBlockLineNumbersField } from "./code-block-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "./projection-state.ts";

function createPerformanceState(markdownSource: string, diagnostics: WysiwygDiagnostics) {
  return EditorState.create({
    doc: markdownSource,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      EditorState.allowMultipleSelections.of(true),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
    ],
  });
}

function delta(
  before: WysiwygDiagnosticsSnapshot,
  after: WysiwygDiagnosticsSnapshot,
  key:
    | "fullIndexBuildCount"
    | "fullProjectionBuildCount"
    | "dirtyBlockRebuildCount"
    | "dirtyCodeBlockRebuildCount",
): number {
  return after[key] - before[key];
}

function codeBlockAt(index: MarkdownRangeIndex, position: number): MarkdownRangeRecord {
  const record = index.at(position).find((candidate) => candidate.kind === "deferred-code");
  if (!record?.codeBlock) {
    throw new Error(`Expected a code block at ${position}.`);
  }
  return record;
}

function recordIds(index: MarkdownRangeIndex): readonly string[] {
  return index.byKind("deferred-code").map((record) => record.id);
}

function expectIncrementalDelta(
  before: WysiwygDiagnosticsSnapshot,
  after: WysiwygDiagnosticsSnapshot,
): void {
  expect(delta(before, after, "fullIndexBuildCount")).toBe(0);
  expect(delta(before, after, "fullProjectionBuildCount")).toBe(0);
  expect(delta(before, after, "dirtyBlockRebuildCount")).toBe(1);
  expect(delta(before, after, "dirtyCodeBlockRebuildCount")).toBe(1);
}

describe("M2 code-block incremental performance budgets", () => {
  it("M2C-P01-P03/P05-P06 stays local on the fixed 50x200 plus 20,000-line fixture", () => {
    const fixture = getM2CodeBlockPerformanceFixture();
    const diagnostics = new WysiwygDiagnostics();
    let state = createPerformanceState(fixture.markdown, diagnostics);
    expect(ensureSyntaxTree(state, state.doc.length, 10_000)?.length).toBe(state.doc.length);
    state = state.update({ effects: refreshMarkdownParseCoverageEffect.of(null) }).state;
    let index = state.field(markdownRangeIndexField);
    const initialProjection = inspectWysiwygProjection(state);

    expect(index.byKind("deferred-code")).toHaveLength(fixture.fencedBlockCount);
    expect(
      index.byKind("deferred-code").every((record) => record.codeBlock?.blockStatus === "closed"),
    ).toBe(true);
    expect(diagnostics.snapshot()).toMatchObject({
      fullIndexBuildCount: 2,
      fullProjectionBuildCount: 2,
      dirtyBlockRebuildCount: 0,
      dirtyCodeBlockRebuildCount: 0,
    });

    const regularNeedle = "regular-025-line-100";
    const regularPosition = state.doc.toString().indexOf(regularNeedle);
    const beforeSelection = diagnostics.snapshot();
    state = state.update({ selection: EditorSelection.cursor(regularPosition) }).state;
    const afterSelection = diagnostics.snapshot();
    expect(delta(beforeSelection, afterSelection, "fullIndexBuildCount")).toBe(0);
    expect(delta(beforeSelection, afterSelection, "fullProjectionBuildCount")).toBe(0);
    expect(delta(beforeSelection, afterSelection, "dirtyBlockRebuildCount")).toBe(0);
    expect(delta(beforeSelection, afterSelection, "dirtyCodeBlockRebuildCount")).toBe(0);

    index = state.field(markdownRangeIndexField);
    const idsBeforeBodyEdit = recordIds(index);
    const editedBodyRecord = codeBlockAt(index, regularPosition);
    const beforeBodyEdit = diagnostics.snapshot();
    state = state.update({ changes: { from: regularPosition + 8, insert: "X" } }).state;
    const afterBodyEdit = diagnostics.snapshot();
    const bodyIndex = state.field(markdownRangeIndexField);
    expectIncrementalDelta(beforeBodyEdit, afterBodyEdit);
    expect(recordIds(bodyIndex).filter((id) => !idsBeforeBodyEdit.includes(id))).toHaveLength(1);
    expect(bodyIndex.get(editedBodyRecord.id)).toBeNull();
    expect(inspectWysiwygProjection(state).layoutDecorationCount).toBe(
      initialProjection.layoutDecorationCount,
    );
    expect(afterBodyEdit.lastDirtyBlockRanges).toHaveLength(1);
    expect(afterBodyEdit.lastDirtyBlockRanges[0].from).toBeLessThanOrEqual(regularPosition);
    expect(afterBodyEdit.lastDirtyBlockRanges[0].to).toBeGreaterThan(regularPosition);
    const nextBlockPosition = state.doc.toString().indexOf("regular-026-line-000");
    expect(afterBodyEdit.lastDirtyBlockRanges[0].to).toBeLessThan(nextBlockPosition);

    const bodySource = state.doc.toString();
    const infoBodyPosition = bodySource.indexOf("regular-010-line-000");
    const infoTokenFrom = bodySource.lastIndexOf("```text", infoBodyPosition) + 3;
    const idsBeforeInfoEdit = recordIds(bodyIndex);
    const infoRecord = codeBlockAt(bodyIndex, infoBodyPosition);
    const beforeInfoEdit = diagnostics.snapshot();
    state = state.update({
      changes: { from: infoTokenFrom, to: infoTokenFrom + 4, insert: "python" },
    }).state;
    const afterInfoEdit = diagnostics.snapshot();
    const infoIndex = state.field(markdownRangeIndexField);
    expectIncrementalDelta(beforeInfoEdit, afterInfoEdit);
    expect(recordIds(infoIndex).filter((id) => !idsBeforeInfoEdit.includes(id))).toHaveLength(1);
    expect(infoIndex.get(infoRecord.id)).toBeNull();
    expect(codeBlockAt(infoIndex, infoBodyPosition + 2).codeBlock?.languageInfo).toMatchObject({
      token: "python",
      resolvedName: "Python",
    });

    const hugePosition = state.doc.toString().indexOf("huge-line-10000");
    const idsBeforeHugeEdit = recordIds(infoIndex);
    const hugeRecord = codeBlockAt(infoIndex, hugePosition);
    const beforeHugeEdit = diagnostics.snapshot();
    state = state.update({ changes: { from: hugePosition + 5, insert: "X" } }).state;
    const afterHugeEdit = diagnostics.snapshot();
    const hugeIndex = state.field(markdownRangeIndexField);
    expectIncrementalDelta(beforeHugeEdit, afterHugeEdit);
    expect(recordIds(hugeIndex).filter((id) => !idsBeforeHugeEdit.includes(id))).toHaveLength(1);
    expect(hugeIndex.get(hugeRecord.id)).toBeNull();
    expect(inspectWysiwygProjection(state).layoutDecorationCount).toBe(
      initialProjection.layoutDecorationCount,
    );
  });
});
