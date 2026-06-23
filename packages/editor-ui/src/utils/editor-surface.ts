export function isEditorBlankSurface(
  target: EventTarget | null,
  scroller: HTMLElement | null,
  proseMirror: HTMLElement | null
): boolean {
  return target === scroller || target === proseMirror;
}

type NativeSelectionState = Pick<Selection, "isCollapsed" | "rangeCount">;

export function hasNonCollapsedNativeSelection(selection: NativeSelectionState | null): boolean {
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
}

export function shouldPlaceCursorAtDocumentEnd(
  target: EventTarget | null,
  scroller: HTMLElement | null,
  proseMirror: HTMLElement | null,
  selection: NativeSelectionState | null
): boolean {
  return isEditorBlankSurface(target, scroller, proseMirror) && !hasNonCollapsedNativeSelection(selection);
}
