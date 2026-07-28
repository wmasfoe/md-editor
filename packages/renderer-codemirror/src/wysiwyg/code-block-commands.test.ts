import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Transaction,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { WysiwygDiagnostics, provideWysiwygDiagnostics } from "../diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../markdown/extensions.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";
import { editorModeField } from "../mode.ts";
import {
  protectedWysiwygChangeRejectedEffect,
  wysiwygChangeProtection,
} from "./change-protection.ts";
import {
  codeBlockBackspace,
  codeBlockDelete,
  codeBlockEnter,
  codeBlockSelectAll,
  codeBlockShiftTab,
  codeBlockTab,
  copyCodeBlockBodyById,
  provideCodeBlockClipboard,
  readCodeBlockBodyText,
  setCodeBlockLanguageById,
} from "./code-block-commands.ts";
import { codeBlockLineNumbersField } from "./code-block-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  startWysiwygCompositionGuardEffect,
  wysiwygProjectionField,
} from "./projection-state.ts";

class CommandHarness {
  transactions: Transaction[] = [];

  constructor(
    state: EditorState,
    readonly diagnostics: WysiwygDiagnostics,
  ) {
    this.state = state;
  }

  state: EditorState;
  composing = false;
  focused = false;

  readonly view = {
    get state() {
      return harnessSlot.state;
    },
    get composing() {
      return harnessSlot.composing;
    },
    dispatch(spec: Transaction | TransactionSpec) {
      const transaction = spec instanceof Transaction ? spec : harnessSlot.state.update(spec);
      harnessSlot.transactions.push(transaction);
      harnessSlot.state = transaction.state;
    },
    focus() {
      harnessSlot.focused = true;
    },
  } as unknown as EditorView;
}

let harnessSlot: CommandHarness;

function createHarness(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
  writeClipboardText?: (text: string) => Promise<void>,
): CommandHarness {
  const diagnostics = new WysiwygDiagnostics();
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      EditorState.allowMultipleSelections.of(true),
      indentUnit.of("  "),
      provideWysiwygDiagnostics(diagnostics),
      provideCodeBlockClipboard(writeClipboardText),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });
  harnessSlot = new CommandHarness(state, diagnostics);
  return harnessSlot;
}

function firstCodeBlock(state: EditorState): MarkdownRangeRecord {
  const record = state.field(markdownRangeIndexField).byKind("deferred-code")[0];
  if (!record?.codeBlock) {
    throw new Error("Expected a code-block record.");
  }
  return record;
}

describe("renderer code-block commands", () => {
  it("M2C-U11 copies fenced LF body slices and indented semantic lines only", () => {
    const fenced = createHarness("```ts meta=1\none\n\nthree\n```\n");
    expect(readCodeBlockBodyText(fenced.state, firstCodeBlock(fenced.state))).toBe(
      "one\n\nthree\n",
    );

    const indented = createHarness("    first\n\n      second\n    \n");
    expect(readCodeBlockBodyText(indented.state, firstCodeBlock(indented.state))).toBe(
      "first\n\n  second",
    );

    const empty = createHarness("```js\n```\n");
    expect(readCodeBlockBodyText(empty.state, firstCodeBlock(empty.state))).toBe("");
  });

  it("M2C-U12 and I14 replace only the leading known language token in one authorized transaction", () => {
    const doc = "```ts meta=1 keep\nconst value = 1;\n```\n";
    const harness = createHarness(doc, EditorSelection.cursor(doc.indexOf("const")));
    const record = firstCodeBlock(harness.state);

    expect(setCodeBlockLanguageById(harness.view, record.id, "javascript")).toBe(true);
    expect(harness.transactions).toHaveLength(1);
    expect(harness.state.doc.toString()).toBe("```javascript meta=1 keep\nconst value = 1;\n```\n");
    expect(harness.transactions[0].annotation(Transaction.addToHistory)).not.toBe(false);
  });

  it("M2C-U13 and I15 applies Plain suffix rules exactly", () => {
    const noSuffixDoc = "```ts\nbody\n```\n";
    const noSuffix = createHarness(
      noSuffixDoc,
      EditorSelection.cursor(noSuffixDoc.indexOf("body")),
    );
    expect(setCodeBlockLanguageById(noSuffix.view, firstCodeBlock(noSuffix.state).id, "")).toBe(
      true,
    );
    expect(noSuffix.state.doc.toString()).toBe("```\nbody\n```\n");

    const suffixDoc = "```ts meta=1\nbody\n```\n";
    const suffix = createHarness(suffixDoc, EditorSelection.cursor(suffixDoc.indexOf("body")));
    expect(setCodeBlockLanguageById(suffix.view, firstCodeBlock(suffix.state).id, "")).toBe(true);
    expect(suffix.state.doc.toString()).toBe("```text meta=1\nbody\n```\n");
  });

  it("inserts a language token for no-info fenced blocks and treats Plain as no-op", () => {
    const doc = "```\nbody\n```\n";
    const plain = createHarness(doc, EditorSelection.cursor(doc.indexOf("body")));
    expect(setCodeBlockLanguageById(plain.view, firstCodeBlock(plain.state).id, "")).toBe(false);
    expect(plain.state.doc.toString()).toBe(doc);
    expect(plain.transactions).toHaveLength(0);

    const typed = createHarness(doc, EditorSelection.cursor(doc.indexOf("body")));
    expect(setCodeBlockLanguageById(typed.view, firstCodeBlock(typed.state).id, "ts")).toBe(true);
    expect(typed.transactions).toHaveLength(1);
    expect(typed.state.doc.toString()).toBe("```ts\nbody\n```\n");
  });

  it("preserves whitespace-only info when inserting a language token", () => {
    const doc = "```   \nbody\n```\n";
    const plain = createHarness(doc, EditorSelection.cursor(doc.indexOf("body")));
    expect(setCodeBlockLanguageById(plain.view, firstCodeBlock(plain.state).id, "")).toBe(false);
    expect(plain.state.doc.toString()).toBe(doc);

    const typed = createHarness(doc, EditorSelection.cursor(doc.indexOf("body")));
    expect(setCodeBlockLanguageById(typed.view, firstCodeBlock(typed.state).id, "python")).toBe(
      true,
    );
    expect(typed.state.doc.toString()).toBe("```python   \nbody\n```\n");
  });

  it("I03-I04 edits fenced and indented semantic bodies without changing structural prefixes", () => {
    const fencedDoc = "```\nalpha\n```\n";
    const fenced = createHarness(fencedDoc, EditorSelection.cursor(fencedDoc.indexOf("alpha")));
    expect(codeBlockTab(fenced.view)).toBe(true);
    expect(fenced.state.doc.toString()).toBe("```\n  alpha\n```\n");
    expect(codeBlockShiftTab(fenced.view)).toBe(true);
    expect(fenced.state.doc.toString()).toBe(fencedDoc);
    expect(codeBlockEnter(fenced.view)).toBe(true);
    expect(fenced.state.doc.toString()).toBe("```\n\nalpha\n```\n");

    const indentedDoc = "    alpha\n";
    const indented = createHarness(
      indentedDoc,
      EditorSelection.cursor(indentedDoc.indexOf("alpha")),
    );
    expect(codeBlockEnter(indented.view)).toBe(true);
    expect(indented.state.doc.toString()).toBe("    \n    alpha\n");
    expect(codeBlockTab(indented.view)).toBe(true);
    expect(indented.state.doc.toString()).toBe("    \n      alpha\n");
    expect(codeBlockShiftTab(indented.view)).toBe(true);
    expect(indented.state.doc.toString()).toBe("    \n    alpha\n");
  });

  it("materializes one editable body line when Enter is pressed in an empty fenced block", () => {
    const doc = "```js\n```\n";
    const bodyAnchor = doc.lastIndexOf("```");
    const harness = createHarness(doc, EditorSelection.cursor(bodyAnchor + "```".length));

    expect(codeBlockEnter(harness.view)).toBe(true);
    expect(harness.state.doc.toString()).toBe("```js\n\n```\n");
    expect(harness.state.selection.main.from).toBe(bodyAnchor);
    expect(harness.state.selection.main.to).toBe(bodyAnchor);
    expect(harness.transactions).toHaveLength(1);
  });

  it("materializes empty fenced bodies before applying their first Tab indentation", () => {
    const doc = "```js\n```\n";
    const bodyAnchor = doc.lastIndexOf("```");
    const harness = createHarness(doc, EditorSelection.cursor(bodyAnchor + "```".length));

    expect(codeBlockTab(harness.view)).toBe(true);
    expect(harness.state.doc.toString()).toBe("```js\n  \n```\n");
    expect(harness.state.selection.main.from).toBe(bodyAnchor + 2);
    expect(harness.state.selection.main.to).toBe(bodyAnchor + 2);
    expect(harness.transactions).toHaveLength(1);
  });

  it("I03 indents each selected semantic line instead of replacing non-empty selections", () => {
    const doc = "```\none\ntwo\nthree\n```\n";
    const harness = createHarness(
      doc,
      EditorSelection.single(doc.indexOf("one") + 1, doc.indexOf("three") - 1),
    );

    expect(codeBlockTab(harness.view)).toBe(true);
    expect(harness.transactions).toHaveLength(1);
    expect(harness.state.doc.toString()).toBe("```\n  one\n  two\nthree\n```\n");
  });

  it("I08 applies one native transaction across code-block multi-selections", () => {
    const doc = "```\none\n```\n\n```\ntwo\n```\n";
    const harness = createHarness(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("one")),
        EditorSelection.cursor(doc.indexOf("two")),
      ]),
    );

    expect(codeBlockTab(harness.view)).toBe(true);
    expect(harness.transactions).toHaveLength(1);
    expect(harness.state.selection.ranges).toHaveLength(2);
    expect(harness.state.doc.toString()).toBe("```\n  one\n```\n\n```\n  two\n```\n");
  });

  it("I04 reuses exact nested indented structural prefixes on Enter", () => {
    const doc = "- item\n\n        nested\n";
    const harness = createHarness(doc, EditorSelection.cursor(doc.indexOf("nested") + 3));

    expect(codeBlockEnter(harness.view)).toBe(true);
    expect(harness.state.doc.toString()).toBe("- item\n\n        nes\n      ted\n");
  });

  it("I05/I13 handles first and last semantic body boundaries as protected no-ops", () => {
    const doc = "```\nalpha\n```\n";
    const start = createHarness(doc, EditorSelection.cursor(doc.indexOf("alpha")));
    expect(codeBlockBackspace(start.view)).toBe(true);
    expect(start.state.doc.toString()).toBe(doc);
    expect(start.diagnostics.snapshot().protectedChangeRejectionCount).toBe(1);

    const end = createHarness(doc, EditorSelection.cursor(doc.indexOf("alpha") + "alpha\n".length));
    expect(codeBlockDelete(end.view)).toBe(true);
    expect(end.state.doc.toString()).toBe(doc);
    expect(end.diagnostics.snapshot().protectedChangeRejectionCount).toBe(1);
  });

  it("I06 selects one semantic code body first and delegates the exact second Mod-A", () => {
    const doc = "before\n\n```\none\ntwo\n```\n";
    const harness = createHarness(doc, EditorSelection.cursor(doc.indexOf("one")));

    expect(codeBlockSelectAll(harness.view)).toBe(true);
    expect(harness.state.selection.main.from).toBe(doc.indexOf("one"));
    expect(harness.state.selection.main.to).toBe(doc.indexOf("```", doc.indexOf("one")));
    expect(codeBlockSelectAll(harness.view)).toBe(false);

    const multi = createHarness(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("one")),
        EditorSelection.cursor(doc.indexOf("two")),
      ]),
    );
    expect(codeBlockSelectAll(multi.view)).toBe(false);
  });

  it.each([
    ["input.type", "typed\n"],
    ["input.paste", "pasted\n"],
    ["delete.selection", ""],
    ["delete.cut", ""],
  ] as const)(
    "I16 rejects broad %s changes that touch fenced or indented structural syntax",
    (userEvent, insert) => {
      for (const doc of [
        "before\n\n```ts\nbody\n```\n\nafter\n",
        "before\n\n    alpha\n      beta\n\nafter\n",
      ]) {
        const selection = EditorSelection.single(0, doc.length);
        const harness = createHarness(doc, selection);
        const transaction = harness.state.update({
          changes: { from: selection.main.from, to: selection.main.to, insert },
          userEvent,
        });

        expect(transaction.docChanged).toBe(false);
        expect(transaction.state.doc.toString()).toBe(doc);
        expect(transaction.state.selection).toEqual(selection);
        expect(
          transaction.effects.some((effect) => effect.is(protectedWysiwygChangeRejectedEffect)),
        ).toBe(true);
        expect(harness.diagnostics.snapshot().protectedChangeRejectionCount).toBe(1);
      }
    },
  );

  it("I16 uses the injected clipboard adapter and records success/failure without changing selection", async () => {
    const copied: string[] = [];
    const doc = "```\none\n```\n";
    const harness = createHarness(doc, EditorSelection.cursor(doc.indexOf("one")), async (text) => {
      copied.push(text);
    });
    const record = firstCodeBlock(harness.state);
    const beforeSelection = harness.state.selection;

    await expect(copyCodeBlockBodyById(harness.view, record.id)).resolves.toBe(true);
    expect(copied).toEqual(["one\n"]);
    expect(harness.state.selection).toBe(beforeSelection);
    expect(harness.diagnostics.snapshot()).toMatchObject({
      codeBlockCopyInvocationCount: 1,
      codeBlockCopySuccessCount: 1,
      codeBlockCopyFailureCount: 0,
    });

    const failing = createHarness(doc, EditorSelection.cursor(doc.indexOf("one")), async () => {
      throw new Error("clipboard denied");
    });
    await expect(
      copyCodeBlockBodyById(failing.view, firstCodeBlock(failing.state).id),
    ).resolves.toBe(false);
    expect(failing.diagnostics.snapshot()).toMatchObject({
      codeBlockCopyInvocationCount: 1,
      codeBlockCopySuccessCount: 0,
      codeBlockCopyFailureCount: 1,
    });
  });

  it("I10 delegates structural commands while IME composition is active or guarded", () => {
    const doc = "```\nbody\n```\n";
    const composing = createHarness(doc, EditorSelection.cursor(doc.indexOf("body")));
    composing.composing = true;
    expect(codeBlockEnter(composing.view)).toBe(false);
    expect(codeBlockTab(composing.view)).toBe(false);
    expect(codeBlockShiftTab(composing.view)).toBe(false);
    expect(codeBlockBackspace(composing.view)).toBe(false);
    expect(codeBlockDelete(composing.view)).toBe(false);
    expect(codeBlockSelectAll(composing.view)).toBe(false);
    expect(composing.transactions).toHaveLength(0);

    const guarded = createHarness(doc, EditorSelection.cursor(doc.indexOf("body")));
    guarded.view.dispatch({
      effects: startWysiwygCompositionGuardEffect.of([
        { from: doc.indexOf("body"), to: doc.indexOf("body") },
      ]),
      annotations: Transaction.addToHistory.of(false),
    });
    expect(codeBlockTab(guarded.view)).toBe(false);
    expect(guarded.transactions).toHaveLength(1);
    expect(guarded.state.doc.toString()).toBe(doc);
  });
});
