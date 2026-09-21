import { markdown } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { WysiwygDiagnostics, provideWysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import type { MarkdownRangeRecord } from "../../src/markdown/range-types.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  leadingIndentColumns,
  resolveCodeBlockIndentPlan,
  resolveHiddenIndentRange,
  stripCodeBlockIndent,
} from "../../src/wysiwyg/code-block-indent.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import { readCodeBlockBodyText } from "../../src/wysiwyg/code-block-commands.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";

function createState(doc: string): EditorState {
  const cursor = doc.indexOf("const");
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor < 0 ? 0 : cursor),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      EditorState.allowMultipleSelections.of(true),
      indentUnit.of("  "),
      provideWysiwygDiagnostics(new WysiwygDiagnostics()),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
    ],
  });
}

function firstCodeBlock(state: EditorState): MarkdownRangeRecord {
  const record = state.field(markdownRangeIndexField).byKind("deferred-code")[0];
  if (!record?.codeBlock) {
    throw new Error("Expected a code-block record.");
  }
  return record;
}

interface HiddenIndentRange {
  readonly from: number;
  readonly to: number;
}

/** 读取投影层隐藏的结构性缩进前缀装饰。 */
function hiddenIndentRanges(state: EditorState): HiddenIndentRange[] {
  const ranges: HiddenIndentRange[] = [];
  state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, state.doc.length, (from, to, value) => {
      if (value.spec.hiddenCodeBlockIndent === true) {
        ranges.push({ from, to });
      }
    });
  return ranges;
}

/** 读取代码行上注入的 CSS 变量（缩进量）。 */
function codeLineStyles(state: EditorState): string[] {
  const styles: string[] = [];
  state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, state.doc.length, (_from, _to, value) => {
      const className = value.spec.attributes?.class;
      if (typeof className === "string" && className.includes("cm-md-code-line")) {
        styles.push(value.spec.attributes?.style ?? "");
      }
    });
  return styles;
}

describe("code block structural indent", () => {
  it("counts leading indent columns and strips at most the structural width per line", () => {
    expect(leadingIndentColumns("  const a = 1;")).toBe(2);
    expect(leadingIndentColumns("\tconst a = 1;")).toBe(4);
    expect(leadingIndentColumns("const a = 1;")).toBe(0);

    expect(stripCodeBlockIndent("  a\n    b\n", 2)).toBe("a\n  b\n");
    expect(stripCodeBlockIndent("  a\n", 0)).toBe("  a\n");
    expect(stripCodeBlockIndent("", 2)).toBe("");
  });

  it("hides the structural indent of a top-level indented fence without moving the card", () => {
    const state = createState("Before\n\n  ```ts\n  const a = 1;\n  ```\n\nAfter\n");
    const record = firstCodeBlock(state);
    expect(resolveCodeBlockIndentPlan(record, state)).toEqual({
      stripColumns: 2,
      cardInsetColumns: 0,
    });
    expect(hiddenIndentRanges(state)).toEqual([
      { from: state.doc.line(4).from, to: state.doc.line(4).from + 2 },
    ]);
    expect(codeLineStyles(state).every((style) => !style.includes("--md-code-inset"))).toBe(true);
  });

  it("hides the container indent and shifts the card for a list-child fence", () => {
    const doc = "- item\n\n  ```ts\n  const a = 1;\n  ```\n";
    const state = createState(doc);
    const record = firstCodeBlock(state);
    expect(resolveCodeBlockIndentPlan(record, state)).toEqual({
      stripColumns: 2,
      cardInsetColumns: 2,
    });
    expect(hiddenIndentRanges(state)).toEqual([
      { from: state.doc.line(4).from, to: state.doc.line(4).from + 2 },
    ]);
    expect(codeLineStyles(state)).toEqual(["--md-code-inset: 2"]);
  });

  it("keeps indentation that belongs to the code content itself", () => {
    const doc = "- item\n\n  ```ts\n    const a = 1;\n  ```\n";
    const state = createState(doc);
    const record = firstCodeBlock(state);
    expect(resolveCodeBlockIndentPlan(record, state).cardInsetColumns).toBe(2);
    // 正文行有 4 个空格，只隐藏 2 列结构缩进，其余属于代码内容。
    expect(hiddenIndentRanges(state)).toEqual([
      { from: state.doc.line(4).from, to: state.doc.line(4).from + 2 },
    ]);
  });

  it("produces no indent decoration for a non-indented fence", () => {
    const state = createState("```ts\nconst a = 1;\n```\n");
    const record = firstCodeBlock(state);
    expect(resolveCodeBlockIndentPlan(record, state)).toEqual({
      stripColumns: 0,
      cardInsetColumns: 0,
    });
    expect(hiddenIndentRanges(state)).toEqual([]);
    expect(codeLineStyles(state)).toEqual([""]);
  });

  it("hides the indent of the visible code line of an empty indented fence", () => {
    const state = createState("Before\n\n  ```ts\n  ```\n\nAfter\n");
    const record = firstCodeBlock(state);
    expect(resolveCodeBlockIndentPlan(record, state)).toEqual({
      stripColumns: 2,
      cardInsetColumns: 0,
    });
    // 空体代码块唯一的可见代码行是闭合围栏行，它同样属于列表/围栏缩进的承载行。
    expect(hiddenIndentRanges(state)).toEqual([
      { from: state.doc.line(4).from, to: state.doc.line(4).from + 2 },
    ]);
  });

  it("returns no hidden range for lines without structural whitespace", () => {
    const state = createState("```ts\nconst a = 1;\n```\n");
    expect(resolveHiddenIndentRange(state, state.doc.line(2).from, 2)).toBeNull();
    expect(resolveHiddenIndentRange(state, state.doc.line(2).from, 0)).toBeNull();
  });

  it("copies the body without the structural indent", () => {
    const indented = createState("  ```ts\n  const a = 1;\n  ```\n");
    expect(readCodeBlockBodyText(indented, firstCodeBlock(indented))).toBe("const a = 1;\n");

    const plain = createState("```ts\n  const a = 1;\n```\n");
    expect(readCodeBlockBodyText(plain, firstCodeBlock(plain))).toBe("  const a = 1;\n");

    const listChild = createState("- item\n\n  ```ts\n  const a = 1;\n  ```\n");
    expect(readCodeBlockBodyText(listChild, firstCodeBlock(listChild))).toBe("const a = 1;\n");
  });
});
