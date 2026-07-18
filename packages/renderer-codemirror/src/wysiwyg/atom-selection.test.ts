import { history, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField, setEditorModeEffect } from "../mode.ts";
import { moveAtomVertically, selectWysiwygAtom } from "./atom-selection.ts";
import {
  clearMarkdownAtomSelection,
  deleteMarkdownAtomForward,
  deleteMarkdownMarkupBackward,
  selectMarkdownAtomBackward,
  selectMarkdownAtomForward,
} from "./markdown-commands.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
} from "./projection-state.ts";

interface CommandResult {
  readonly handled: boolean;
  readonly state: EditorState;
  readonly transactionCount: number;
}

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
): EditorState {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["links", "images", "thematic-breaks", "default-atoms"]),
      wysiwygProjectionField,
    ],
  });
}

function runCommand(state: EditorState, command: StateCommand): CommandResult {
  let nextState = state;
  let transactionCount = 0;
  const handled = command({
    state,
    dispatch(transaction) {
      transactionCount += 1;
      nextState = transaction.state;
    },
  });
  return { handled, state: nextState, transactionCount };
}

describe("WYSIWYG atom selection commands", () => {
  it.each([
    ["![alt](image.png)", "image", deleteMarkdownAtomForward],
    ["![alt](image.png)", "image", deleteMarkdownMarkupBackward],
    ["---", "thematic-break", deleteMarkdownAtomForward],
    ["---", "thematic-break", deleteMarkdownMarkupBackward],
  ] as const)(
    "deletes an exactly selected %s atom in one undoable transaction",
    (doc, kind, command) => {
      const initial = createState(doc);
      const atom = initial.field(markdownRangeIndexField).byKind(kind)[0];
      const selected = initial.update({
        selection: EditorSelection.range(atom.fullRange.from, atom.fullRange.to),
      }).state;
      const result = runCommand(selected, command);

      expect(result).toMatchObject({ handled: true, transactionCount: 1 });
      expect(result.state.doc.toString()).toBe("");
      const restored = runCommand(result.state, undo).state;
      expect(restored.doc.toString()).toBe(doc);
      expect(runCommand(restored, redo).state.doc.toString()).toBe("");
    },
  );

  it("does not hijack a broad cross-block deletion", () => {
    const doc = "Before\n\n![alt](image.png)\n\n---\n\nAfter";
    const state = createState(doc, EditorSelection.range(2, doc.length - 2));

    expect(runCommand(state, deleteMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });
    expect(runCommand(state, deleteMarkdownMarkupBackward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });
    expect(state.doc.toString()).toBe(doc);
  });

  it("deletes compatible multi-selections atomically and rejects mixed selections", () => {
    const doc = "![a](a.png) x ![b](b.png)";
    const initial = createState(doc);
    const images = initial.field(markdownRangeIndexField).byKind("image");
    const selected = initial.update({
      selection: EditorSelection.create(
        images.map((image) => EditorSelection.range(image.fullRange.from, image.fullRange.to)),
      ),
    }).state;
    const deleted = runCommand(selected, deleteMarkdownAtomForward);
    expect(deleted).toMatchObject({ handled: true, transactionCount: 1 });
    expect(deleted.state.doc.toString()).toBe(" x ");
    expect(runCommand(deleted.state, undo).state.doc.toString()).toBe(doc);

    const mixed = initial.update({
      selection: EditorSelection.create([
        EditorSelection.range(images[0].fullRange.from, images[0].fullRange.to),
        EditorSelection.cursor(doc.indexOf(" x ") + 1),
      ]),
    }).state;
    expect(runCommand(mixed, deleteMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });
  });

  it("reveals adjacent image source with a real cursor and restores its widget on exit", () => {
    const doc = "x![alt](image.png)y";
    const initial = createState(doc);
    const image = initial.field(markdownRangeIndexField).byKind("image")[0];
    const before = initial.update({
      selection: EditorSelection.cursor(image.fullRange.from),
    }).state;
    expect(inspectWysiwygProjection(before).activeSyntaxIds).not.toContain(image.id);

    const revealed = runCommand(before, selectMarkdownAtomForward);
    expect(revealed).toMatchObject({ handled: true, transactionCount: 1 });
    expect(revealed.state.selection.main.empty).toBe(true);
    expect(revealed.state.selection.main.head).toBeGreaterThan(image.fullRange.from);
    expect(revealed.state.selection.main.head).toBeLessThan(image.fullRange.to);
    expect(inspectWysiwygProjection(revealed.state)).toMatchObject({
      activeSyntaxIds: [image.id],
      selectedAtomIds: [],
      atomicRangeCount: 0,
    });

    const after = initial.update({
      selection: EditorSelection.cursor(image.fullRange.to),
    }).state;
    const reverse = runCommand(after, selectMarkdownAtomBackward);
    expect(reverse.state.selection.main.empty).toBe(true);
    expect(reverse.state.selection.main).toMatchObject({
      anchor: image.fullRange.to - 1,
      head: image.fullRange.to - 1,
    });
    expect(inspectWysiwygProjection(reverse.state).activeSyntaxIds).toEqual([image.id]);
  });

  it.each([
    ["forward", "Before\n\n![alt](image.png)\n\nAfter"],
    ["backward", "Before\n\n![alt](image.png)\n\nAfter"],
  ] as const)("reveals image source during %s visual-line movement", (direction, doc) => {
    let state = createState(doc);
    const image = state.field(markdownRangeIndexField).byKind("image")[0];
    const start =
      direction === "forward" ? doc.indexOf("Before") + "Before".length : doc.indexOf("After");
    state = state.update({ selection: EditorSelection.cursor(start) }).state;
    const nativeTarget = EditorSelection.cursor(
      direction === "forward" ? image.fullRange.from : image.fullRange.to,
      0,
      undefined,
      24,
    );
    let transactionCount = 0;
    const view = {
      composing: false,
      get state() {
        return state;
      },
      moveVertically() {
        return nativeTarget;
      },
      dispatch(transaction: ReturnType<EditorState["update"]>) {
        transactionCount += 1;
        state = transaction.state;
      },
    } as unknown as EditorView;

    expect(moveAtomVertically(view, direction)).toBe(true);
    expect(transactionCount).toBe(1);
    expect(state.selection.main.empty).toBe(true);
    expect(state.selection.main.head).toBeGreaterThan(image.fullRange.from);
    expect(state.selection.main.head).toBeLessThan(image.fullRange.to);
    expect(state.selection.main.goalColumn).toBe(24);
    expect(inspectWysiwygProjection(state)).toMatchObject({
      activeSyntaxIds: [image.id],
      selectedAtomIds: [],
      atomicRangeCount: 0,
    });
  });

  it.each([
    ["---", "forward"],
    ["---", "backward"],
    ["***", "forward"],
    ["***", "backward"],
    ["___", "forward"],
    ["___", "backward"],
  ] as const)("selects a %s thematic break during %s visual-line movement", (marker, direction) => {
    const doc = `Before\n\n${marker}\nAfter`;
    let state = createState(doc);
    const thematicBreak = state.field(markdownRangeIndexField).byKind("thematic-break")[0];
    const start =
      direction === "forward" ? doc.indexOf("Before") + "Before".length : doc.indexOf("After");
    state = state.update({ selection: EditorSelection.cursor(start) }).state;
    const nativeTarget = EditorSelection.cursor(
      direction === "forward" ? thematicBreak.fullRange.from : thematicBreak.fullRange.to,
      0,
      undefined,
      24,
    );
    const view = {
      composing: false,
      get state() {
        return state;
      },
      moveVertically() {
        return nativeTarget;
      },
      dispatch(transaction: ReturnType<EditorState["update"]>) {
        state = transaction.state;
      },
    } as unknown as EditorView;

    expect(moveAtomVertically(view, direction)).toBe(true);
    expect(state.selection.main).toMatchObject(
      direction === "forward"
        ? { anchor: thematicBreak.fullRange.from, head: thematicBreak.fullRange.to }
        : { anchor: thematicBreak.fullRange.to, head: thematicBreak.fullRange.from },
    );
    expect(inspectWysiwygProjection(state)).toMatchObject({
      selectedAtomIds: [thematicBreak.id],
      atomicRangeCount: 1,
    });
  });

  it("navigates across default atoms but does not classify exact selection as deletable", () => {
    const doc = "x[^note]y";
    const initial = createState(doc);
    const footnote = initial.field(markdownRangeIndexField).byKind("footnote")[0];
    if (!footnote) {
      throw new Error("Expected a footnote atom.");
    }
    const before = initial.update({
      selection: EditorSelection.cursor(footnote.fullRange.from),
    }).state;
    const selected = runCommand(before, selectMarkdownAtomForward);

    expect(selected).toMatchObject({ handled: true, transactionCount: 1 });
    expect(selected.state.selection.main).toMatchObject({
      anchor: footnote.fullRange.from,
      head: footnote.fullRange.to,
    });
    expect(inspectWysiwygProjection(selected.state).selectedAtomIds).toEqual([footnote.id]);
    expect(runCommand(selected.state, deleteMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });
    expect(runCommand(selected.state, deleteMarkdownMarkupBackward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });

    const exited = runCommand(selected.state, selectMarkdownAtomForward);
    expect(exited.state.selection.main).toMatchObject({
      anchor: footnote.fullRange.to,
      head: footnote.fullRange.to,
    });
    expect(inspectWysiwygProjection(exited.state).selectedAtomIds).toEqual([]);
  });

  it("selects and exits compatible default atoms across multiple ranges all-or-nothing", () => {
    const doc = "[^a] text [^b]";
    const initial = createState(doc);
    const footnotes = initial.field(markdownRangeIndexField).byKind("footnote");
    const cursors = initial.update({
      selection: EditorSelection.create(
        footnotes.map((footnote) => EditorSelection.cursor(footnote.fullRange.from)),
      ),
    }).state;
    const selected = runCommand(cursors, selectMarkdownAtomForward);

    expect(selected).toMatchObject({ handled: true, transactionCount: 1 });
    expect(selected.state.selection.ranges).toEqual(
      footnotes.map((footnote) =>
        EditorSelection.range(footnote.fullRange.from, footnote.fullRange.to),
      ),
    );
    expect(new Set(inspectWysiwygProjection(selected.state).selectedAtomIds)).toEqual(
      new Set(footnotes.map((footnote) => footnote.id)),
    );
    expect(runCommand(selected.state, deleteMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });

    const exited = runCommand(selected.state, selectMarkdownAtomForward);
    expect(exited).toMatchObject({ handled: true, transactionCount: 1 });
    expect(exited.state.selection.ranges.map((range) => range.head)).toEqual(
      footnotes.map((footnote) => footnote.fullRange.to),
    );
    expect(inspectWysiwygProjection(exited.state).selectedAtomIds).toEqual([]);
  });

  it("clears explicit atom selection with Escape without changing history", () => {
    const doc = "---";
    let state = createState(doc);
    const thematicBreak = state.field(markdownRangeIndexField).byKind("thematic-break")[0];
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: TransactionSpec) {
        state = state.update(spec).state;
      },
      focus() {},
    } as unknown as EditorView;
    expect(selectWysiwygAtom(view, thematicBreak.id)).toBe(true);
    expect(inspectWysiwygProjection(state).selectedAtomIds).toEqual([thematicBreak.id]);

    const cleared = runCommand(state, clearMarkdownAtomSelection);
    expect(cleared).toMatchObject({ handled: true, transactionCount: 1 });
    expect(cleared.state.selection.main.empty).toBe(true);
    expect(cleared.state.selection.main.head).toBe(thematicBreak.fullRange.to);
    expect(inspectWysiwygProjection(cleared.state).selectedAtomIds).toEqual([]);
    expect(runCommand(cleared.state, undo).handled).toBe(false);
  });

  it("uses all-or-nothing navigation and bypasses structured commands during composition", () => {
    const doc = "![a](a.png) text";
    const initial = createState(doc);
    const image = initial.field(markdownRangeIndexField).byKind("image")[0];
    const mixed = initial.update({
      selection: EditorSelection.create([
        EditorSelection.cursor(image.fullRange.from),
        EditorSelection.cursor(doc.length),
      ]),
    }).state;
    expect(runCommand(mixed, selectMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });

    const guarded = initial.update({
      selection: EditorSelection.range(image.fullRange.from, image.fullRange.to),
      effects: startWysiwygCompositionGuardEffect.of([image.fullRange]),
    }).state;
    expect(runCommand(guarded, deleteMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });

    const source = guarded.update({ effects: setEditorModeEffect.of("source") }).state;
    expect(runCommand(source, deleteMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });
    expect(runCommand(source, selectMarkdownAtomForward)).toMatchObject({
      handled: false,
      transactionCount: 0,
    });
  });
});
