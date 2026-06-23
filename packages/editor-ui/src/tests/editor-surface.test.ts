import { describe, expect, it } from "vitest";
import {
  hasNonCollapsedNativeSelection,
  isEditorBlankSurface,
  shouldPlaceCursorAtDocumentEnd
} from "../utils/editor-surface";

describe("editor blank surface detection", () => {
  it("matches only the scroller or ProseMirror root surfaces", () => {
    const scroller = {} as HTMLElement;
    const proseMirror = {} as HTMLElement;
    const paragraph = {} as HTMLElement;
    const image = {} as HTMLImageElement;

    expect(isEditorBlankSurface(scroller, scroller, proseMirror)).toBe(true);
    expect(isEditorBlankSurface(proseMirror, scroller, proseMirror)).toBe(true);
    expect(isEditorBlankSurface(paragraph, scroller, proseMirror)).toBe(false);
    expect(isEditorBlankSurface(image, scroller, proseMirror)).toBe(false);
  });

  it("does not move the cursor to the end while a native cross-block selection is active", () => {
    const scroller = {} as HTMLElement;
    const proseMirror = {} as HTMLElement;
    const activeSelection = { rangeCount: 1, isCollapsed: false } as Selection;

    expect(
      shouldPlaceCursorAtDocumentEnd(proseMirror, scroller, proseMirror, activeSelection)
    ).toBe(false);
    expect(hasNonCollapsedNativeSelection(activeSelection)).toBe(true);
  });

  it.each([
    ["paragraph to blockquote", "paragraph", "blockquote"],
    ["blockquote to paragraph", "blockquote", "paragraph"],
    ["paragraph to list item", "paragraph", "list-item"],
    ["list item to blockquote", "list-item", "blockquote"]
  ])(
    "preserves a native cross-block selection from %s when the event lands on the ProseMirror root",
    (_, anchorBlock, focusBlock) => {
      const { scroller, proseMirror, selection } = createCrossBlockSelection(anchorBlock, focusBlock);

      expect(
        shouldPlaceCursorAtDocumentEnd(proseMirror, scroller, proseMirror, selection)
      ).toBe(false);
    }
  );

  it("does not let the follow-up click event collapse a drag-created cross-block selection", () => {
    const { scroller, proseMirror, selection } = createCrossBlockSelection("paragraph", "blockquote");

    expect(shouldPlaceCursorAtDocumentEnd(proseMirror, scroller, proseMirror, selection)).toBe(false);
    expect(shouldPlaceCursorAtDocumentEnd(scroller, scroller, proseMirror, selection)).toBe(false);
  });

  it("allows blank-surface cursor placement when no native range is selected", () => {
    const scroller = {} as HTMLElement;
    const proseMirror = {} as HTMLElement;
    const collapsedSelection = { rangeCount: 1, isCollapsed: true } as Selection;

    expect(shouldPlaceCursorAtDocumentEnd(scroller, scroller, proseMirror, null)).toBe(true);
    expect(
      shouldPlaceCursorAtDocumentEnd(proseMirror, scroller, proseMirror, collapsedSelection)
    ).toBe(true);
    expect(hasNonCollapsedNativeSelection(collapsedSelection)).toBe(false);
  });

  it("treats a stale empty range as safe for blank-surface cursor placement", () => {
    const scroller = {} as HTMLElement;
    const proseMirror = {} as HTMLElement;
    const staleEmptySelection = { rangeCount: 0, isCollapsed: false } as Selection;

    expect(
      shouldPlaceCursorAtDocumentEnd(proseMirror, scroller, proseMirror, staleEmptySelection)
    ).toBe(true);
    expect(hasNonCollapsedNativeSelection(staleEmptySelection)).toBe(false);
  });
});

function createCrossBlockSelection(anchorBlock: string, focusBlock: string) {
  const scroller = { dataset: { role: "scroller" } } as unknown as HTMLElement;
  const proseMirror = { dataset: { role: "prosemirror" } } as unknown as HTMLElement;
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: { parentElement: { dataset: { block: anchorBlock } } },
    focusNode: { parentElement: { dataset: { block: focusBlock } } }
  } as unknown as Selection;

  return { scroller, proseMirror, selection };
}
