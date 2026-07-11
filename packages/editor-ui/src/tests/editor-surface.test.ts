import { describe, expect, it } from "vitest";
import {
  hasNonCollapsedNativeSelection,
  isEditorBlankSurface,
  resolveBlankSurfaceCursorAnchor,
  shouldHandleBlankSurfaceCursor,
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
      shouldHandleBlankSurfaceCursor(proseMirror, scroller, proseMirror, activeSelection),
    ).toBe(false);
    expect(hasNonCollapsedNativeSelection(activeSelection)).toBe(true);
  });

  it.each([
    ["paragraph to blockquote", "paragraph", "blockquote"],
    ["blockquote to paragraph", "blockquote", "paragraph"],
    ["paragraph to list item", "paragraph", "list-item"],
    ["list item to blockquote", "list-item", "blockquote"],
  ])(
    "preserves a native cross-block selection from %s when the event lands on the ProseMirror root",
    (_, anchorBlock, focusBlock) => {
      const { scroller, proseMirror, selection } = createCrossBlockSelection(
        anchorBlock,
        focusBlock,
      );

      expect(shouldHandleBlankSurfaceCursor(proseMirror, scroller, proseMirror, selection)).toBe(
        false,
      );
    },
  );

  it("does not let the follow-up click event collapse a drag-created cross-block selection", () => {
    const { scroller, proseMirror, selection } = createCrossBlockSelection(
      "paragraph",
      "blockquote",
    );

    expect(shouldHandleBlankSurfaceCursor(proseMirror, scroller, proseMirror, selection)).toBe(
      false,
    );
    expect(shouldHandleBlankSurfaceCursor(scroller, scroller, proseMirror, selection)).toBe(false);
  });

  it("allows blank-surface cursor placement when no native range is selected", () => {
    const scroller = {} as HTMLElement;
    const proseMirror = {} as HTMLElement;
    const collapsedSelection = { rangeCount: 1, isCollapsed: true } as Selection;

    expect(shouldHandleBlankSurfaceCursor(scroller, scroller, proseMirror, null)).toBe(true);
    expect(
      shouldHandleBlankSurfaceCursor(proseMirror, scroller, proseMirror, collapsedSelection),
    ).toBe(true);
    expect(hasNonCollapsedNativeSelection(collapsedSelection)).toBe(false);
  });

  it("treats a stale empty range as safe for blank-surface cursor placement", () => {
    const scroller = {} as HTMLElement;
    const proseMirror = {} as HTMLElement;
    const staleEmptySelection = { rangeCount: 0, isCollapsed: false } as Selection;

    expect(
      shouldHandleBlankSurfaceCursor(proseMirror, scroller, proseMirror, staleEmptySelection),
    ).toBe(true);
    expect(hasNonCollapsedNativeSelection(staleEmptySelection)).toBe(false);
  });

  it("places a click above the first content block at the document start", () => {
    const proseMirror = createProseMirrorSurface([
      { top: 100, bottom: 140, position: 8 },
      { top: 180, bottom: 220, position: 16 },
    ]);

    expect(resolveBlankSurfaceCursorAnchor(80, proseMirror, 24, resolveTestBlockEnd)).toEqual({
      position: 0,
      bias: 1,
    });
  });

  it("places a click between content blocks at the preceding block end", () => {
    const proseMirror = createProseMirrorSurface([
      { top: 100, bottom: 140, position: 8 },
      { top: 180, bottom: 220, position: 16 },
    ]);

    expect(resolveBlankSurfaceCursorAnchor(160, proseMirror, 24, resolveTestBlockEnd)).toEqual({
      position: 8,
      bias: -1,
    });
  });

  it("uses the current line block when a root-surface click shares its vertical range", () => {
    const proseMirror = createProseMirrorSurface([
      { top: 100, bottom: 140, position: 8 },
      { top: 180, bottom: 220, position: 16 },
    ]);

    expect(resolveBlankSurfaceCursorAnchor(200, proseMirror, 24, resolveTestBlockEnd)).toEqual({
      position: 16,
      bias: -1,
    });
  });

  it("places a click below the last content block at the document end", () => {
    const proseMirror = createProseMirrorSurface([
      { top: 100, bottom: 140, position: 8 },
      { top: 180, bottom: 220, position: 16 },
    ]);

    expect(resolveBlankSurfaceCursorAnchor(260, proseMirror, 24, resolveTestBlockEnd)).toEqual({
      position: 24,
      bias: -1,
    });
  });

  it("skips an unmappable root decoration and uses the preceding content block", () => {
    const proseMirror = createProseMirrorSurface([
      { top: 100, bottom: 140, position: 8 },
      { top: 150, bottom: 170, position: null },
      { top: 180, bottom: 220, position: 16 },
    ]);

    expect(resolveBlankSurfaceCursorAnchor(160, proseMirror, 24, resolveTestBlockEnd)).toEqual({
      position: 8,
      bias: -1,
    });
  });
});

function createCrossBlockSelection(anchorBlock: string, focusBlock: string) {
  const scroller = { dataset: { role: "scroller" } } as unknown as HTMLElement;
  const proseMirror = { dataset: { role: "prosemirror" } } as unknown as HTMLElement;
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    anchorNode: { parentElement: { dataset: { block: anchorBlock } } },
    focusNode: { parentElement: { dataset: { block: focusBlock } } },
  } as unknown as Selection;

  return { scroller, proseMirror, selection };
}

function createProseMirrorSurface(
  blocks: Array<{ top: number; bottom: number; position: number | null }>,
): HTMLElement {
  const children = blocks.map(({ top, bottom, position }) => ({
    childNodes: [],
    dataset: position === null ? {} : { position: String(position) },
    getBoundingClientRect: () => ({ top, bottom }),
  }));

  return {
    children,
  } as unknown as HTMLElement;
}

function resolveTestBlockEnd(block: Element): number | null {
  if (!(block as HTMLElement).dataset.position) return null;
  const position = Number((block as HTMLElement).dataset.position);
  return Number.isFinite(position) ? position : null;
}
