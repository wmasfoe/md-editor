import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { type DecorationSet, type WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import { wysiwygChangeProtection } from "./change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "./projection-state.ts";
import { FrontmatterHeaderWidget } from "./widgets/frontmatter-header-widget.ts";

const DOCUMENT = [
  "---",
  "# source comment",
  'title: "Exact title"',
  "defaults: &defaults enabled",
  "copy: *defaults",
  "---",
  "# Body",
  "",
].join("\n");

interface DecorationSummary {
  readonly from: number;
  readonly to: number;
  readonly role: string;
  readonly className: string;
  readonly widget: WidgetType | null;
}

function createState(doc = DOCUMENT): {
  readonly state: EditorState;
  readonly diagnostics: WysiwygDiagnostics;
} {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["frontmatter"]),
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  return { state, diagnostics };
}

function decorations(set: DecorationSet, length: number): readonly DecorationSummary[] {
  const output: DecorationSummary[] = [];
  set.between(0, length, (from, to, value) => {
    output.push({
      from,
      to,
      role: String(value.spec.wysiwygRole ?? ""),
      className: String(value.spec.class ?? ""),
      widget: (value.spec.widget as WidgetType | undefined) ?? null,
    });
  });
  return output;
}

describe("Frontmatter projection", () => {
  it("hides only exact fences and highlights the editable YAML body in the main document", () => {
    const { state } = createState();
    const record = state.field(markdownRangeIndexField).byKind("frontmatter")[0];
    const projection = state.field(wysiwygProjectionField);
    const layout = decorations(projection.layoutDecorations, state.doc.length);
    const atomic = decorations(projection.atomicRanges, state.doc.length);
    const header = layout.find((item) => item.widget instanceof FrontmatterHeaderWidget)?.widget as
      FrontmatterHeaderWidget | undefined;

    expect(state.doc.toString()).toBe(DOCUMENT);
    expect(record.renderPolicy).toBe("frontmatter-panel");
    expect(header?.value).toMatchObject({ status: "closed", errorCount: 0 });
    expect(layout.filter((item) => item.role === "frontmatter-header")).toEqual([
      expect.objectContaining({ from: 0, to: 3 }),
    ]);
    expect(layout.filter((item) => item.role === "frontmatter-closing-fence")).toEqual([
      expect.objectContaining({
        from: DOCUMENT.indexOf("---", 4),
        to: DOCUMENT.indexOf("---", 4) + 3,
      }),
    ]);
    expect(layout.some((item) => item.role === "frontmatter-yaml-key")).toBe(true);
    expect(layout.some((item) => item.role === "frontmatter-yaml-comment")).toBe(true);
    expect(layout.some((item) => item.role === "frontmatter-yaml-string")).toBe(true);
    expect(layout.some((item) => item.role === "frontmatter-yaml-anchor")).toBe(true);
    expect(layout.some((item) => item.role === "frontmatter-yaml-alias")).toBe(true);
    expect(atomic.filter((item) => item.role === "frontmatter-fence-atomic")).toHaveLength(2);
    expect(inspectWysiwygProjection(state).protectedRanges).toEqual(record.markerRanges);
  });

  it("edits only YAML source ranges through native history and preserves every other byte", () => {
    const { state } = createState();
    const before = state.doc.toString();
    const titleFrom = before.indexOf("Exact title");
    const transaction = state.update({
      changes: { from: titleFrom, to: titleFrom + "Exact title".length, insert: "Edited title" },
      selection: EditorSelection.cursor(titleFrom + "Edited title".length),
      userEvent: "input.type",
    });
    const edited = transaction.state;
    const expected = before.replace("Exact title", "Edited title");
    let replayed = edited;

    expect(transaction.docChanged).toBe(true);
    expect(edited.doc.toString()).toBe(expected);
    expect(edited.doc.sliceString(0, 3)).toBe("---");
    expect(edited.doc.sliceString(expected.indexOf("---", 4), expected.indexOf("---", 4) + 3)).toBe(
      "---",
    );
    expect(undoDepth(edited)).toBe(1);
    expect(undo({ state: edited, dispatch: (next) => (replayed = next.state) })).toBe(true);
    expect(replayed.doc.toString()).toBe(before);
    expect(redo({ state: replayed, dispatch: (next) => (replayed = next.state) })).toBe(true);
    expect(replayed.doc.toString()).toBe(expected);
  });

  it("does not rebuild or reparse the selection-independent panel while the cursor moves", () => {
    const { state, diagnostics } = createState();
    const initialProjection = state.field(wysiwygProjectionField);
    const title = DOCUMENT.indexOf("Exact title");
    const moved = state.update({ selection: EditorSelection.cursor(title) }).state;

    expect(moved.field(wysiwygProjectionField)).toBe(initialProjection);
    expect(inspectWysiwygProjection(moved)).toMatchObject({
      activeSyntaxIds: [],
      lastSelectionDeltaIds: [],
    });
    expect(diagnostics.snapshot().layoutDecorationReplaceCount).toBe(1);
  });

  it("keeps broad selection and multiple ranges while exact fence edits require source mode", () => {
    const { state } = createState();
    const selected = state.update({
      selection: EditorSelection.range(0, DOCUMENT.length),
    }).state;
    expect(selected.doc.sliceString(selected.selection.main.from, selected.selection.main.to)).toBe(
      DOCUMENT,
    );
    const multiple = state.update({
      selection: EditorSelection.create([
        EditorSelection.range(DOCUMENT.indexOf("title"), DOCUMENT.indexOf("title") + 5),
        EditorSelection.cursor(DOCUMENT.indexOf("copy")),
      ]),
    }).state;
    expect(multiple.selection.ranges).toHaveLength(2);

    const blocked = state.update({ changes: { from: 1, to: 2, insert: "x" } });
    expect(blocked.docChanged).toBe(false);
    expect(blocked.state.doc.toString()).toBe(DOCUMENT);

    const source = state.update({
      effects: setEditorModeEffect.of("source"),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const edited = source.update({ changes: { from: 1, to: 2, insert: "x" } }).state;
    expect(edited.doc.toString()).toBe("-x-" + DOCUMENT.slice(3));
    expect(inspectWysiwygProjection(source)).toMatchObject({
      mode: "source",
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
      protectedRanges: [],
    });
  });

  it("keeps invalid and unterminated YAML editable with an explicit error panel", () => {
    const invalid = createState("---\ntitle: [invalid\n---\n").state;
    const invalidLayout = decorations(
      invalid.field(wysiwygProjectionField).layoutDecorations,
      invalid.doc.length,
    );
    const invalidHeader = invalidLayout.find(
      (item) => item.widget instanceof FrontmatterHeaderWidget,
    )?.widget as FrontmatterHeaderWidget | undefined;
    expect(invalidHeader?.value.errorCount).toBeGreaterThan(0);
    expect(invalidLayout.some((item) => item.role === "frontmatter-yaml-error")).toBe(true);

    const source = "---\ntitle: Missing fence\n";
    const unterminated = createState(source).state;
    const layout = decorations(
      unterminated.field(wysiwygProjectionField).layoutDecorations,
      unterminated.doc.length,
    );
    const header = layout.find((item) => item.widget instanceof FrontmatterHeaderWidget)?.widget as
      FrontmatterHeaderWidget | undefined;
    expect(header?.value).toMatchObject({ status: "unterminated", errorCount: 1 });
    expect(layout.filter((item) => item.role === "frontmatter-closing-fence")).toEqual([]);
    const insertAt = source.indexOf("Missing");
    const edited = unterminated.update({ changes: { from: insertAt, insert: "still " } }).state;
    expect(edited.doc.toString()).toBe(source.replace("Missing", "still Missing"));
  });

  it("does not treat later delimiters, HTML, or MDX as Frontmatter", () => {
    const doc = ["Body", "", "---", "title: Later", "---", "", "<div />", "<Component />", ""].join(
      "\n",
    );
    const { state } = createState(doc);
    expect(state.field(markdownRangeIndexField).byKind("frontmatter")).toEqual([]);
    expect(inspectWysiwygProjection(state)).toMatchObject({
      layoutDecorationCount: 0,
      atomicRangeCount: 0,
    });
    expect(state.doc.toString()).toBe(doc);
  });
});
