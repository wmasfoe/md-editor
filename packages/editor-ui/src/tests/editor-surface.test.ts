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
});
