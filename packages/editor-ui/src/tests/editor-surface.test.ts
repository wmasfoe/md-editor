import { describe, expect, it } from "vitest";
import { isEditorBlankSurface } from "../utils/editor-surface";

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
});
