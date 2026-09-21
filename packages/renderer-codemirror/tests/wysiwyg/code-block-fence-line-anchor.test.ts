import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type SelectionRange } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  codeBlockLineNumbersField,
  getCodeBlockProtectedRanges,
} from "../../src/wysiwyg/code-block-projection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";

/**
 * 围栏代码块的行装饰锚点回归：
 *
 * CM6 的行装饰只在行首生效，位置晚于 `line.from` 的 `Decoration.line` 会被静默丢弃，
 * 该行随即按全高渲染。围栏字符的 `from` 在下面两种情况下都晚于行首：
 * - 围栏行带前置缩进（CommonMark 允许 1~3 个空格）；
 * - 围栏位于列表/引用容器内，正文行的缩进被 lezer 从 CodeText 中剔除。
 * 症状是工具栏与代码正文之间出现一行高度的断层，或代码行卡片样式整体丢失。
 */
function createProjectionState(
  selection: EditorSelection | SelectionRange,
  doc: string,
): EditorState {
  const diagnostics = new WysiwygDiagnostics();
  return EditorState.create({
    doc,
    selection,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(diagnostics),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["blocks"]),
      codeBlockLineNumbersField,
      wysiwygProjectionField,
    ],
  });
}

function collectLineDecorations(
  state: EditorState,
  matches: (attributes: Record<string, string>) => boolean,
): number[] {
  const positions: number[] = [];
  state
    .field(wysiwygProjectionField)
    .layoutDecorations.between(0, state.doc.length, (from, _to, value) => {
      const attributes = (value.spec as { attributes?: Record<string, string> }).attributes;
      if (attributes && matches(attributes)) {
        positions.push(from);
      }
    });
  return positions;
}

function structuralLinePositions(state: EditorState): number[] {
  return collectLineDecorations(
    state,
    (attributes) => attributes["data-md-code-structural-line"] === "fence",
  );
}

function bodyLinePositions(state: EditorState): number[] {
  return collectLineDecorations(
    state,
    (attributes) =>
      Boolean(attributes["data-md-code-block-id"]) &&
      Boolean(attributes.class?.includes("cm-md-code-line")),
  );
}

describe("code block fence line anchoring", () => {
  it("anchors hidden structural lines at the physical line start for indented fences", () => {
    const doc = ["Before", "", "  ```ts", "  const a = 1;", "  ```", "", "After"].join("\n");
    const state = createProjectionState(EditorSelection.cursor(doc.indexOf("const")), doc);

    // 围栏字符位于第 3/5 行的第 3 列，行装饰必须落在行首，否则装饰会被 CM6 丢弃。
    expect(state.doc.line(3).text.startsWith("  ```")).toBe(true);
    expect(structuralLinePositions(state)).toEqual([
      state.doc.line(3).from,
      state.doc.line(5).from,
    ]);
    expect(bodyLinePositions(state)).toEqual([state.doc.line(4).from]);
  });

  it("anchors body lines at the physical line start when a list container strips indentation", () => {
    const doc = ["- item", "", "  ```ts", "  const a = 1;", "  ```"].join("\n");
    const state = createProjectionState(EditorSelection.cursor(doc.indexOf("const")), doc);

    expect(structuralLinePositions(state)).toEqual([
      state.doc.line(3).from,
      state.doc.line(5).from,
    ]);
    expect(bodyLinePositions(state)).toEqual([state.doc.line(4).from]);
  });

  it("keeps the empty body line visible for an indented empty fence", () => {
    const doc = ["Before", "", "  ```ts", "  ```", "", "After"].join("\n");
    const state = createProjectionState(EditorSelection.cursor(doc.indexOf("```")), doc);

    // 闭合围栏行即空体代码块唯一的可见代码行，不能被结构行折叠吞掉。
    expect(structuralLinePositions(state)).toEqual([state.doc.line(3).from]);
    expect(bodyLinePositions(state)).toEqual([state.doc.line(4).from]);
  });

  it("keeps the protected syntax ranges unchanged for indented fences", () => {
    const doc = ["Before", "", "  ```ts", "  const a = 1;", "  ```", "", "After"].join("\n");
    const state = createProjectionState(EditorSelection.cursor(doc.indexOf("const")), doc);
    const record = state.field(markdownRangeIndexField).byKind("deferred-code")[0];

    expect(getCodeBlockProtectedRanges(record).map((range) => [range.from, range.to])).toEqual([
      [10, 13],
      [13, 15],
      [33, 36],
    ]);
  });
});
