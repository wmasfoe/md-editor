import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction, type SelectionRange } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
} from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import {
  protectedWysiwygChangeRejectedEffect,
  WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE,
  wysiwygChangeProtection,
} from "./change-protection.ts";
import {
  clearWysiwygAtomSelectionEffect,
  configureWysiwygProjectionFeatures,
  endWysiwygCompositionGuardEffect,
  inspectWysiwygProjection,
  selectWysiwygAtomEffect,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
  type WysiwygProjectionFeature,
} from "./projection-state.ts";
import {
  codeBlockLineNumbersField,
  setCodeBlockLineNumbersEffect,
} from "./code-block-projection.ts";
import { buildVisibleMarkdownMarks } from "./visible-marks.ts";

const DOCUMENT = [
  "# Heading",
  "",
  "Paragraph with **bold** and [label](https://example.com).",
  "",
  "![alt](asset.png)",
  "",
  "<https://example.org>",
  "",
].join("\n");

function createProjectionState(
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
  features: readonly WysiwygProjectionFeature[] = [],
  doc = DOCUMENT,
): { readonly state: EditorState; readonly diagnostics: WysiwygDiagnostics } {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(features),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  return { state, diagnostics };
}

function expectedSelectionDelta(previous: readonly string[], next: readonly string[]): string[] {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return [
    ...previous.filter((id) => !nextSet.has(id)),
    ...next.filter((id) => !previousSet.has(id)),
  ];
}

describe("WYSIWYG projection StateField", () => {
  it("owns immutable projection summaries and direct empty providers before features activate", () => {
    const { state, diagnostics } = createProjectionState();
    const projection = state.field(wysiwygProjectionField);
    const snapshot = inspectWysiwygProjection(state);

    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.activeSyntaxIds)).toBe(true);
    expect(snapshot.rangeIndexVersion).toBe(state.field(markdownRangeIndexField).version);
    expect(snapshot.layoutDecorationCount).toBe(0);
    expect(snapshot.atomicRangeCount).toBe(0);
    expect(diagnostics.snapshot().layoutDecorationReplaceCount).toBe(1);
    const fakeView = { state } as EditorView;
    expect(
      state
        .facet(EditorView.decorations)
        .some(
          (provider) =>
            provider === projection.layoutDecorations ||
            (typeof provider === "function" && provider(fakeView) === projection.layoutDecorations),
        ),
    ).toBe(true);
    expect(
      state
        .facet(EditorView.atomicRanges)
        .some((provider) => provider(fakeView) === projection.atomicRanges),
    ).toBe(true);
  });

  it("keeps the range index while source mode empties projection-owned state", () => {
    const { state } = createProjectionState();
    const index = state.field(markdownRangeIndexField);
    const sourceState = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const projection = inspectWysiwygProjection(sourceState);

    expect(sourceState.field(markdownRangeIndexField)).toBe(index);
    expect(projection).toMatchObject({
      mode: "source",
      activeSyntaxIds: [],
      selectedAtomIds: [],
      compositionGuardRanges: [],
      protectedRanges: [],
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
    });
    expect(undoDepth(sourceState)).toBe(0);

    const movedInSource = sourceState.update({
      selection: EditorSelection.cursor(DOCUMENT.indexOf("label") + 1),
    }).state;
    expect(inspectWysiwygProjection(movedInSource)).toEqual(projection);

    const wysiwygState = movedInSource.update({
      effects: setEditorModeEffect.of("wysiwyg"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(inspectWysiwygProjection(wysiwygState).mode).toBe("wysiwyg");
    expect(inspectWysiwygProjection(wysiwygState).activeSyntaxIds.length).toBeGreaterThan(0);
    expect(wysiwygState.field(markdownRangeIndexField)).toBe(index);
    expect(undoDepth(wysiwygState)).toBe(0);
  });

  it("updates activity from only the old/new selection span union", () => {
    const boldPosition = DOCUMENT.indexOf("bold") + 1;
    const linkPosition = DOCUMENT.indexOf("label") + 1;
    const { state, diagnostics } = createProjectionState(EditorSelection.cursor(boldPosition));
    const index = state.field(markdownRangeIndexField);
    const before = inspectWysiwygProjection(state);
    const nextState = state.update({ selection: EditorSelection.cursor(linkPosition) }).state;
    const after = inspectWysiwygProjection(nextState);

    expect(nextState.field(markdownRangeIndexField)).toBe(index);
    expect(after.lastSelectionDeltaIds).toEqual(
      expectedSelectionDelta(before.activeSyntaxIds, after.activeSyntaxIds),
    );
    expect(diagnostics.snapshot()).toMatchObject({
      fullIndexBuildCount: 1,
      dirtyBlockRebuildCount: 0,
      selectionDeltaUpdateCount: 1,
      layoutDecorationReplaceCount: 1,
    });
  });

  it("unions active syntax ids across every selection range", () => {
    const boldPosition = DOCUMENT.indexOf("bold") + 1;
    const linkPosition = DOCUMENT.indexOf("label") + 1;
    const selection = EditorSelection.create([
      EditorSelection.cursor(boldPosition),
      EditorSelection.range(linkPosition + 2, linkPosition),
    ]);
    const { state } = createProjectionState(selection);
    const index = state.field(markdownRangeIndexField);
    const expectedIds = new Set([
      ...index.at(boldPosition).map((record) => record.id),
      ...index.overlapping(linkPosition, linkPosition + 2).map((record) => record.id),
    ]);

    expect(new Set(inspectWysiwygProjection(state).activeSyntaxIds)).toEqual(expectedIds);
    expect(state.selection.ranges).toHaveLength(2);
    expect(state.selection.ranges[1].anchor).toBe(linkPosition + 2);
    expect(state.selection.ranges[1].head).toBe(linkPosition);
  });

  it("applies atom and composition guard effects without doc or history changes", () => {
    const imagePosition = DOCUMENT.indexOf("![alt]") + 2;
    const { state } = createProjectionState(EditorSelection.cursor(imagePosition));
    const image = state.field(markdownRangeIndexField).byKind("image")[0];
    if (!image) {
      throw new Error("Expected an image record.");
    }
    const guarded = state.update({
      selection: EditorSelection.range(image.fullRange.from, image.fullRange.to),
      effects: [
        selectWysiwygAtomEffect.of({ recordId: image.id, extend: false }),
        startWysiwygCompositionGuardEffect.of([{ from: imagePosition, to: imagePosition }]),
      ],
      annotations: Transaction.addToHistory.of(false),
    }).state;

    expect(guarded.doc).toBe(state.doc);
    expect(inspectWysiwygProjection(guarded)).toMatchObject({
      selectedAtomIds: [image.id],
      compositionGuardRanges: [{ from: imagePosition, to: imagePosition }],
    });
    expect(undoDepth(guarded)).toBe(0);

    const cleared = guarded.update({
      effects: [
        clearWysiwygAtomSelectionEffect.of(null),
        endWysiwygCompositionGuardEffect.of(null),
      ],
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(inspectWysiwygProjection(cleared)).toMatchObject({
      selectedAtomIds: [],
      compositionGuardRanges: [],
    });
    expect(undoDepth(cleared)).toBe(0);
  });

  it("maps the active composition guard through document changes", () => {
    const position = DOCUMENT.indexOf("bold") + 2;
    const { state } = createProjectionState(EditorSelection.cursor(position));
    const guarded = state.update({
      effects: startWysiwygCompositionGuardEffect.of([{ from: position, to: position }]),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const composed = guarded.update({
      changes: { from: position, insert: "输" },
      userEvent: "input.type.compose",
    }).state;

    expect(inspectWysiwygProjection(composed).compositionGuardRanges).toEqual([
      { from: position, to: position + 1 },
    ]);
    expect(composed.selection.main.head).toBe(position);
  });

  it("protects source-only local edits, permits broad deletion, and disables protection in source mode", () => {
    const { state } = createProjectionState(EditorSelection.cursor(0), ["default-atoms"]);
    const autolink = state.field(markdownRangeIndexField).byKind("autolink")[0];
    if (!autolink) {
      throw new Error("Expected an autolink record.");
    }
    const inside = autolink.fullRange.from + 2;
    const blockedTransaction = state.update({
      changes: { from: inside, insert: "x" },
      selection: EditorSelection.cursor(inside + 1),
    });
    expect(blockedTransaction.docChanged).toBe(false);
    expect(blockedTransaction.state.doc.toString()).toBe(DOCUMENT);
    expect(blockedTransaction.state.selection).toEqual(state.selection);
    expect(
      blockedTransaction.effects.some((effect) => effect.is(protectedWysiwygChangeRejectedEffect)),
    ).toBe(true);
    expect(blockedTransaction.effects.find((effect) => effect.is(EditorView.announce))?.value).toBe(
      WYSIWYG_SOURCE_MODE_REQUIRED_MESSAGE,
    );
    expect(undoDepth(blockedTransaction.state)).toBe(0);

    // 恰好等于 protected 范围的选区视为宽选区：整块替换放行
    // （整表/原子选中后直接打字/粘贴等价于先 Delete 再输入）。
    const exactlySelected = state.update({
      selection: EditorSelection.range(autolink.fullRange.from, autolink.fullRange.to),
    }).state;
    const exactDelete = exactlySelected.update({
      changes: autolink.fullRange,
      selection: EditorSelection.cursor(autolink.fullRange.from),
      userEvent: "delete.selection",
    });
    expect(exactDelete.docChanged).toBe(true);
    expect(exactDelete.state.doc.toString().includes("https://example.org")).toBe(false);

    const broadSelection = state.update({
      selection: EditorSelection.range(autolink.fullRange.from - 1, autolink.fullRange.to + 1),
    }).state;
    const broadlyDeleted = broadSelection.update({
      changes: {
        from: broadSelection.selection.main.from,
        to: broadSelection.selection.main.to,
        insert: "replacement",
      },
      userEvent: "input.paste",
    }).state;
    expect(broadlyDeleted.doc.toString()).toContain("replacement");
    expect(broadlyDeleted.doc.toString()).not.toContain("https://example.org");
    expect(undoDepth(broadlyDeleted)).toBe(1);

    const sourceState = state.update({ effects: setEditorModeEffect.of("source") }).state;
    const editedInSource = sourceState.update({ changes: { from: inside, insert: "x" } }).state;
    expect(editedInSource.doc.toString()).not.toBe(DOCUMENT);
    expect(undoDepth(editedInSource)).toBe(1);
  });

  it.each([
    ["quote", "> quote\n", 1],
    ["unordered list", "- item\n", 1],
    ["ordered list", "1. item\n", 1],
    ["task", "- [ ] task\n", 3],
  ])(
    "protects a source-mode cursor preserved inside a hidden %s marker from typing and paste",
    (_kind, doc, markerPosition) => {
      const initial = createProjectionState(EditorSelection.cursor(0), ["blocks"], doc).state;
      const source = initial.update({
        effects: setEditorModeEffect.of("source"),
        annotations: Transaction.addToHistory.of(false),
      }).state;
      const positioned = source.update({
        selection: EditorSelection.cursor(markerPosition),
        annotations: Transaction.addToHistory.of(false),
      }).state;
      const wysiwyg = positioned.update({
        effects: setEditorModeEffect.of("wysiwyg"),
        annotations: Transaction.addToHistory.of(false),
      }).state;

      expect(
        inspectWysiwygProjection(wysiwyg).protectedRanges.some(
          (range) => range.from < markerPosition && range.to > markerPosition,
        ),
      ).toBe(true);
      for (const userEvent of ["input.type", "input.paste"] as const) {
        const attempted = wysiwyg.update({
          changes: { from: markerPosition, insert: "x" },
          selection: EditorSelection.cursor(markerPosition + 1),
          userEvent,
        });
        expect(attempted.docChanged).toBe(false);
        expect(attempted.state.doc.toString()).toBe(doc);
        expect(attempted.state.selection).toEqual(wysiwyg.selection);
        expect(
          attempted.effects.some((effect) => effect.is(protectedWysiwygChangeRejectedEffect)),
        ).toBe(true);
      }
    },
  );

  it("replays source-mode edits through undo and redo after returning to WYSIWYG", () => {
    const document = "<https://example.org>\n";
    const { state } = createProjectionState(EditorSelection.cursor(0), ["default-atoms"], document);
    const autolink = state.field(markdownRangeIndexField).byKind("autolink")[0];
    if (!autolink) {
      throw new Error("Expected an autolink record.");
    }
    const editAt = autolink.fullRange.from + "<https://".length;
    const sourceState = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const edited = sourceState.update({ changes: { from: editAt, insert: "x" } }).state;
    const wysiwyg = edited.update({
      effects: setEditorModeEffect.of("wysiwyg"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    let replayed = wysiwyg;

    expect(wysiwyg.doc.toString()).toBe("<https://xexample.org>\n");
    expect(
      undo({ state: wysiwyg, dispatch: (transaction) => (replayed = transaction.state) }),
    ).toBe(true);
    expect(replayed.doc.toString()).toBe(document);
    expect(
      redo({ state: replayed, dispatch: (transaction) => (replayed = transaction.state) }),
    ).toBe(true);
    expect(replayed.doc.toString()).toBe("<https://xexample.org>\n");
  });

  it("creates a fresh range index and projection state for a fresh document generation state", () => {
    const first = createProjectionState().state;
    const second = createProjectionState().state;

    expect(second.field(markdownRangeIndexField)).not.toBe(first.field(markdownRangeIndexField));
    expect(second.field(wysiwygProjectionField)).not.toBe(first.field(wysiwygProjectionField));
    expect(inspectWysiwygProjection(second)).toEqual(inspectWysiwygProjection(first));
  });

  it("refreshes parser coverage through a non-history projection transaction", () => {
    const { state } = createProjectionState();
    const edited = state.update({
      changes: { from: DOCUMENT.indexOf("bold") + 2, insert: "x" },
      userEvent: "input.type",
    }).state;
    const depthBeforeRefresh = undoDepth(edited);
    const indexBeforeRefresh = edited.field(markdownRangeIndexField);
    const refreshed = edited.update({
      effects: refreshMarkdownParseCoverageEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
    }).state;

    expect(refreshed.field(markdownRangeIndexField)).not.toBe(indexBeforeRefresh);
    expect(inspectWysiwygProjection(refreshed).rangeIndexVersion).toBe(
      indexBeforeRefresh.version + 1,
    );
    expect(undoDepth(refreshed)).toBe(depthBeforeRefresh);
  });

  it("projects closed fenced code blocks with hidden protected syntax and renderer toolbar", () => {
    const doc = ["Before", "", "```ts meta=1", "const x = 1;", "x++;", "```", "", "After"].join(
      "\n",
    );
    const markerPosition = doc.indexOf("```");
    const { state } = createProjectionState(
      EditorSelection.cursor(doc.indexOf("const")),
      ["blocks"],
      doc,
    );
    const record = state.field(markdownRangeIndexField).byKind("deferred-code")[0];
    const projection = state.field(wysiwygProjectionField);
    const layoutSpecs: unknown[] = [];
    const atomicSpecs: unknown[] = [];

    projection.layoutDecorations.between(0, state.doc.length, (_from, _to, value) => {
      layoutSpecs.push(value.spec);
    });
    projection.atomicRanges.between(0, state.doc.length, (_from, _to, value) => {
      atomicSpecs.push(value.spec);
    });

    expect(record?.codeBlock?.blockStatus).toBe("closed");
    expect(inspectWysiwygProjection(state).protectedRanges).toEqual([
      record?.codeBlock?.openingFenceRange,
      record?.codeBlock?.rawInfoRange,
      record?.codeBlock?.closingFenceRange,
    ]);
    expect(
      layoutSpecs.some(
        (spec) => (spec as { hiddenCodeBlockSyntax?: boolean }).hiddenCodeBlockSyntax,
      ),
    ).toBe(true);
    expect(layoutSpecs.some((spec) => "widget" in (spec as Record<string, unknown>))).toBe(true);
    expect(atomicSpecs).toHaveLength(3);

    const blocked = state.update({
      changes: { from: markerPosition + 1, insert: "x" },
      selection: EditorSelection.cursor(markerPosition + 2),
      userEvent: "input.type",
    });
    expect(blocked.docChanged).toBe(false);
    expect(blocked.state.doc.toString()).toBe(doc);
    expect(blocked.effects.some((effect) => effect.is(protectedWysiwygChangeRejectedEffect))).toBe(
      true,
    );
  });

  it("keeps an empty fenced body as one visible semantic code line", () => {
    const doc = ["Before", "", "```js", "```", "", "After"].join("\n");
    const bodyAnchor = doc.lastIndexOf("```");
    const { state } = createProjectionState(EditorSelection.cursor(bodyAnchor), ["blocks"], doc);
    const projection = state.field(wysiwygProjectionField);
    const structuralLines: number[] = [];
    const codeLines: number[] = [];

    projection.layoutDecorations.between(0, state.doc.length, (from, _to, value) => {
      const attributes = (value.spec as { attributes?: Record<string, string> }).attributes;
      if (attributes?.["data-md-code-structural-line"] === "fence") {
        structuralLines.push(from);
      }
      if (attributes?.["data-md-code-block-id"] && attributes.class?.includes("cm-md-code-line")) {
        codeLines.push(from);
      }
    });

    expect(structuralLines).toEqual([doc.indexOf("```")]);
    expect(codeLines).toEqual([bodyAnchor]);
    expect(inspectWysiwygProjection(state).protectedRanges).toHaveLength(3);
  });

  it("protects indented structural indentation while leaving semantic body editable", () => {
    const doc = ["Before", "", "    alpha", "      beta", "", "After"].join("\n");
    const bodyPosition = doc.indexOf("alpha");
    const indentPosition = doc.indexOf("    alpha") + 1;
    const { state } = createProjectionState(EditorSelection.cursor(bodyPosition), ["blocks"], doc);
    const record = state.field(markdownRangeIndexField).byKind("deferred-code")[0];

    expect(record?.codeBlock?.blockKind).toBe("indented");
    expect(inspectWysiwygProjection(state).protectedRanges).toEqual(
      record?.codeBlock?.syntaxIndentRanges,
    );

    const blocked = state.update({
      changes: { from: indentPosition, insert: "x" },
      selection: EditorSelection.cursor(indentPosition + 1),
      userEvent: "input.type",
    });
    expect(blocked.docChanged).toBe(false);

    const edited = state.update({
      changes: { from: bodyPosition, insert: "x" },
      selection: EditorSelection.cursor(bodyPosition + 1),
      userEvent: "input.type",
    }).state;
    expect(edited.doc.toString()).toContain("    xalpha");
  });

  it("adds direct block-local line decorations only when codeBlockLineNumbers is enabled", () => {
    const doc = ["```", "one", "two wrapped source line", "```", "", "tail"].join("\n");
    const { state } = createProjectionState(
      EditorSelection.cursor(doc.indexOf("one")),
      ["blocks"],
      doc,
    );
    const enabled = state.update({
      effects: setCodeBlockLineNumbersEffect.of(true),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const disabledNumbers: string[] = [];
    const enabledNumbers: string[] = [];

    state
      .field(wysiwygProjectionField)
      .layoutDecorations.between(0, state.doc.length, (_from, _to, value) => {
        const attrs = (value.spec as { attributes?: Record<string, string> }).attributes;
        if (attrs?.["data-md-code-line-number"]) {
          disabledNumbers.push(attrs["data-md-code-line-number"]);
        }
      });
    enabled
      .field(wysiwygProjectionField)
      .layoutDecorations.between(0, enabled.doc.length, (_from, _to, value) => {
        const attrs = (value.spec as { attributes?: Record<string, string> }).attributes;
        if (attrs?.["data-md-code-line-number"]) {
          enabledNumbers.push(attrs["data-md-code-line-number"]);
        }
      });

    expect(disabledNumbers).toEqual([]);
    expect(enabledNumbers).toEqual(["1", "2"]);
    expect(undoDepth(enabled)).toBe(0);
  });

  it("fails open for unclosed fenced code and source mode reveals all code syntax", () => {
    const doc = ["Before", "", "```ts", "const x = 1;"].join("\n");
    const { state } = createProjectionState(
      EditorSelection.cursor(doc.indexOf("const")),
      ["blocks"],
      doc,
    );
    const record = state.field(markdownRangeIndexField).byKind("deferred-code")[0];

    expect(record?.codeBlock?.blockStatus).toBe("unclosed");
    expect(inspectWysiwygProjection(state)).toMatchObject({
      protectedRanges: [],
      atomicRangeCount: 0,
    });
    expect(state.field(wysiwygProjectionField).layoutDecorations.size).toBe(0);

    const sourceState = state.update({
      effects: [setEditorModeEffect.of("source"), setCodeBlockLineNumbersEffect.of(true)],
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(inspectWysiwygProjection(sourceState)).toMatchObject({
      mode: "source",
      protectedRanges: [],
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
    });
    expect(sourceState.doc.toString()).toBe(doc);
  });

  it("builds paint-only inline Marks from visible ranges only", () => {
    const { state, diagnostics } = createProjectionState(EditorSelection.cursor(0), [
      "inline-styles",
    ]);
    const bold = state.field(markdownRangeIndexField).byKind("bold")[0];
    const link = state.field(markdownRangeIndexField).byKind("link")[0];
    if (!bold || !link) {
      throw new Error("Expected inline records.");
    }
    const view = {
      state,
      visibleRanges: [{ from: bold.fullRange.from, to: bold.fullRange.to }],
    } as unknown as EditorView;
    const decorations = buildVisibleMarkdownMarks(view);
    const covered: Array<{ from: number; to: number }> = [];
    decorations.between(0, state.doc.length, (from, to) => {
      covered.push({ from, to });
    });

    expect(covered).toEqual([bold.markerRanges[0], bold.contentRange, bold.markerRanges[1]]);
    expect(covered.some((range) => range.from >= link.fullRange.from)).toBe(false);
    expect(diagnostics.snapshot().visibleMarkBuildCount).toBe(1);
  });
});
