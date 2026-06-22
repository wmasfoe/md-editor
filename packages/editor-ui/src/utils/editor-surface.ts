export function isEditorBlankSurface(
  target: EventTarget | null,
  scroller: HTMLElement | null,
  proseMirror: HTMLElement | null
): boolean {
  return target === scroller || target === proseMirror;
}
