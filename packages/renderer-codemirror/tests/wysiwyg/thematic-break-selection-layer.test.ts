import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  computeSelectionMarkers,
  isAtomSelection,
} from "../../src/wysiwyg/code-block-selection.ts";
import { selectWysiwygAtom } from "../../src/wysiwyg/atom-selection.ts";
import {
  configureWysiwygProjectionFeatures,
  inspectWysiwygProjection,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";

function createWysiwygState(doc: string, mode: "wysiwyg" | "source" = "wysiwyg"): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField.init(() => mode),
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["thematic-breaks", "links", "images"]),
      wysiwygProjectionField,
    ],
  });
}

describe("thematic-break atom selection and selection layer markers", () => {
  it("identifies atom selection for thematic-break and skips generating selection markers", () => {
    const doc = "Before\n\n---\n\nAfter\n";
    let state = createWysiwygState(doc);
    const thematicBreak = state.field(markdownRangeIndexField).byKind("thematic-break")[0];
    expect(thematicBreak).toBeDefined();

    const view = {
      get state() {
        return state;
      },
      dispatch(spec: TransactionSpec) {
        state = state.update(spec).state;
      },
      focus() {},
      textDirection: 0,
      scrollDOM: {
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
        clientWidth: 800,
        scrollLeft: 0,
        scrollTop: 0,
      },
    } as unknown as EditorView;

    // 点击/选择分割线原子
    expect(selectWysiwygAtom(view, thematicBreak.id)).toBe(true);
    expect(inspectWysiwygProjection(state).selectedAtomIds).toEqual([thematicBreak.id]);
    expect(state.selection.main.from).toBe(thematicBreak.fullRange.from);
    expect(state.selection.main.to).toBe(thematicBreak.fullRange.to);

    // 验证 isAtomSelection 准确判定
    expect(isAtomSelection(state, state.selection.main)).toBe(true);

    // 验证自绘选区层不会为该原子选区生成任何 RectangleMarker（杜绝在黑框上方绘制多余的蓝色横条）
    const markers = computeSelectionMarkers(view);
    expect(markers).toHaveLength(0);
  });

  it("does not treat regular text selection as atom selection", () => {
    const doc = "Before\n\n---\n\nAfter\n";
    const state = createWysiwygState(doc);
    const textSelection = EditorSelection.range(0, 6); // "Before"
    expect(isAtomSelection(state, textSelection)).toBe(false);
  });

  it("does not treat multi-line drag selection spanning across thematic-break as atom selection", () => {
    const doc = "Before\n\n---\n\nAfter\n";
    const state = createWysiwygState(doc);
    // 划选跨越段落与分割线
    const crossSelection = EditorSelection.range(0, doc.indexOf("After") + 5);
    expect(isAtomSelection(state, crossSelection)).toBe(false);
  });

  it("returns false for isAtomSelection when in source mode", () => {
    const doc = "---\n";
    const sourceState = createWysiwygState(doc, "source");
    const selection = EditorSelection.range(0, 3);
    expect(isAtomSelection(sourceState, selection)).toBe(false);
  });
});
