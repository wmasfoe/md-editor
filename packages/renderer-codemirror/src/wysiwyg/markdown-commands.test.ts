import { history, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { editorModeField } from "../mode.ts";
import {
  continueMarkdownMarkup,
  deleteMarkdownMarkupBackward,
  indentMarkdownList,
  outdentMarkdownList,
  toggleTaskMarkerAt,
  toggleSelectedTasks,
} from "./markdown-commands.ts";
import {
  configureWysiwygProjectionFeatures,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
} from "./projection-state.ts";

interface CommandResult {
  readonly handled: boolean;
  readonly state: EditorState;
  readonly transactionCount: number;
  readonly userEvents: readonly string[];
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
      indentUnit.of("  "),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
      wysiwygProjectionField,
    ],
  });
}

function runCommand(state: EditorState, command: StateCommand): CommandResult {
  let nextState = state;
  let transactionCount = 0;
  const userEvents: string[] = [];
  const handled = command({
    state,
    dispatch(transaction) {
      transactionCount += 1;
      nextState = transaction.state;
      for (const event of [
        "input",
        "input.indent",
        "input.task-toggle",
        "delete",
        "delete.dedent",
      ]) {
        if (transaction.isUserEvent(event)) {
          userEvents.push(event);
        }
      }
    },
  });
  return { handled, state: nextState, transactionCount, userEvents };
}

describe("renderer-owned Markdown structured commands", () => {
  it.each([
    ["- item", "- item\n- "],
    ["* item", "* item\n* "],
    ["+ item", "+ item\n+ "],
    ["9) item", "9) item\n10) "],
    ["> > quote", "> > quote\n> > "],
    ["- [x] done", "- [x] done\n- [ ] "],
  ])("continues %s from parser context in one transaction", (doc, expected) => {
    const result = runCommand(
      createState(doc, EditorSelection.cursor(doc.length)),
      continueMarkdownMarkup,
    );

    expect(result).toMatchObject({ handled: true, transactionCount: 1 });
    expect(result.state.doc.toString()).toBe(expected);
    expect(result.state.selection.main.from).toBe(expected.length);
  });

  it("exits empty top-level and nested list items in one transaction", () => {
    const topLevel = runCommand(
      createState("- ", EditorSelection.cursor(2)),
      continueMarkdownMarkup,
    );
    const nestedDoc = "- parent\n  - ";
    const nested = runCommand(
      createState(nestedDoc, EditorSelection.cursor(nestedDoc.length)),
      continueMarkdownMarkup,
    );

    expect(topLevel.state.doc.toString()).toBe("");
    expect(topLevel.transactionCount).toBe(1);
    expect(nested.state.doc.toString()).toBe("- parent\n- ");
    expect(nested.transactionCount).toBe(1);
  });

  it("continues compatible multi-cursors atomically and rejects an incompatible range", () => {
    const doc = "- one\n- two";
    const compatible = createState(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("one") + 3),
        EditorSelection.cursor(doc.length),
      ]),
    );
    const result = runCommand(compatible, continueMarkdownMarkup);
    expect(result).toMatchObject({ handled: true, transactionCount: 1 });
    expect(result.state.doc.toString()).toBe("- one\n- \n- two\n- ");
    expect(result.state.selection.ranges).toHaveLength(2);

    const incompatible = createState(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("one") + 3),
        EditorSelection.range(doc.indexOf("two"), doc.length),
      ]),
    );
    expect(runCommand(incompatible, continueMarkdownMarkup)).toMatchObject({
      handled: false,
      transactionCount: 0,
      state: incompatible,
    });
  });

  it("indents and outdents list markers after quote prefixes with one mapped transaction", () => {
    const doc = "> - one\n> - two";
    const selected = createState(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("one") + 1),
        EditorSelection.cursor(doc.indexOf("two") + 1),
      ]),
    );
    const indented = runCommand(selected, indentMarkdownList);

    expect(indented).toMatchObject({ handled: true, transactionCount: 1 });
    expect(indented.state.doc.toString()).toBe(">   - one\n>   - two");
    expect(indented.state.selection.ranges).toHaveLength(2);

    const outdented = runCommand(indented.state, outdentMarkdownList);
    expect(outdented).toMatchObject({ handled: true, transactionCount: 1 });
    expect(outdented.state.doc.toString()).toBe(doc);
  });

  it("rejects mixed list/plain Tab and top-level Shift-Tab without partial changes", () => {
    const doc = "- item\n\nplain";
    const mixed = createState(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("item") + 1),
        EditorSelection.cursor(doc.indexOf("plain") + 1),
      ]),
    );
    expect(runCommand(mixed, indentMarkdownList)).toMatchObject({
      handled: false,
      transactionCount: 0,
      state: mixed,
    });

    const topLevel = createState("- item", EditorSelection.cursor(3));
    expect(runCommand(topLevel, outdentMarkdownList)).toMatchObject({
      handled: false,
      transactionCount: 0,
      state: topLevel,
    });
  });

  it("Backspace outdents a nested item before removing its top-level list semantics", () => {
    const nestedDoc = "- parent\n  - child";
    const nestedContentStart = nestedDoc.indexOf("child");
    const first = runCommand(
      createState(nestedDoc, EditorSelection.cursor(nestedContentStart)),
      deleteMarkdownMarkupBackward,
    );

    expect(first).toMatchObject({ handled: true, transactionCount: 1 });
    expect(first.state.doc.toString()).toBe("- parent\n- child");
    const second = runCommand(first.state, deleteMarkdownMarkupBackward);
    expect(second).toMatchObject({ handled: true, transactionCount: 1 });
    expect(second.state.doc.toString()).toBe("- parent\n  child");
  });

  it("Backspace resolves the visible task-text boundary before outdenting", () => {
    const doc = "- parent\n  - [x] child";
    const result = runCommand(
      createState(doc, EditorSelection.cursor(doc.indexOf("child"))),
      deleteMarkdownMarkupBackward,
    );

    expect(result).toMatchObject({ handled: true, transactionCount: 1 });
    expect(result.state.doc.toString()).toBe("- parent\n- [x] child");
  });

  it("toggles exact task marker selections once, preserves directions, and undo/redo is exact", () => {
    const doc = "- [ ] pending\n- [X] done";
    const base = createState(doc);
    const tasks = base.field(markdownRangeIndexField).byKind("task");
    const firstMarker = tasks[0].markerRanges[0];
    const secondMarker = tasks[1].markerRanges[0];
    const selected = base.update({
      selection: EditorSelection.create([
        EditorSelection.range(firstMarker.from, firstMarker.to),
        EditorSelection.range(secondMarker.to, secondMarker.from),
      ]),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const toggled = runCommand(selected, toggleSelectedTasks);

    expect(toggled).toMatchObject({ handled: true, transactionCount: 1 });
    expect(toggled.state.doc.toString()).toBe("- [x] pending\n- [ ] done");
    expect(toggled.state.selection.ranges.map((range) => range.anchor > range.head)).toEqual([
      false,
      true,
    ]);

    const undone = runCommand(toggled.state, undo);
    expect(undone.state.doc.toString()).toBe(doc);
    expect(undone.transactionCount).toBe(1);
    const redone = runCommand(undone.state, redo);
    expect(redone.state.doc.toString()).toBe("- [x] pending\n- [ ] done");
  });

  it("rejects mixed task selections without mutation", () => {
    const doc = "- [ ] task\nplain";
    const base = createState(doc);
    const marker = base.field(markdownRangeIndexField).byKind("task")[0].markerRanges[0];
    const selected = base.update({
      selection: EditorSelection.create([
        EditorSelection.range(marker.from, marker.to),
        EditorSelection.range(doc.indexOf("plain"), doc.length),
      ]),
      annotations: Transaction.addToHistory.of(false),
    }).state;

    expect(runCommand(selected, toggleSelectedTasks)).toMatchObject({
      handled: false,
      transactionCount: 0,
      state: selected,
    });
  });

  it("uses the same one-transaction task toggle for the pointer widget path", () => {
    const doc = "- [ ] task";
    const state = createState(doc);
    const task = state.field(markdownRangeIndexField).byKind("task")[0];
    const marker = task.markerRanges[0];
    let nextState = state;
    let transactionCount = 0;
    const view = {
      state,
      composing: false,
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        transactionCount += 1;
        nextState = state.update(spec).state;
      },
    } as unknown as EditorView;

    expect(toggleTaskMarkerAt(view, { recordId: task.id, from: marker.from, to: marker.to })).toBe(
      true,
    );
    expect(transactionCount).toBe(1);
    expect(nextState.doc.toString()).toBe("- [x] task");

    expect(
      toggleTaskMarkerAt({ ...view, composing: true } as unknown as EditorView, {
        recordId: task.id,
        from: marker.from,
        to: marker.to,
      }),
    ).toBe(false);
    expect(transactionCount).toBe(1);
  });

  it("bypasses every structural command while a composition guard is active", () => {
    const listDoc = "- item";
    const guardedList = createState(listDoc, EditorSelection.cursor(listDoc.length)).update({
      effects: startWysiwygCompositionGuardEffect.of([
        { from: listDoc.length, to: listDoc.length },
      ]),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    for (const command of [
      continueMarkdownMarkup,
      deleteMarkdownMarkupBackward,
      indentMarkdownList,
      outdentMarkdownList,
    ]) {
      expect(runCommand(guardedList, command)).toMatchObject({
        handled: false,
        transactionCount: 0,
        state: guardedList,
      });
    }

    const taskDoc = "- [ ] task";
    const taskBase = createState(taskDoc);
    const marker = taskBase.field(markdownRangeIndexField).byKind("task")[0].markerRanges[0];
    const guardedTask = taskBase.update({
      selection: EditorSelection.range(marker.from, marker.to),
      effects: startWysiwygCompositionGuardEffect.of([marker]),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(runCommand(guardedTask, toggleSelectedTasks)).toMatchObject({
      handled: false,
      transactionCount: 0,
      state: guardedTask,
    });
  });
});
