export function isEditorBlankSurface(
  target: EventTarget | null,
  scroller: HTMLElement | null,
  proseMirror: HTMLElement | null,
): boolean {
  return target === scroller || target === proseMirror;
}

type NativeSelectionState = Pick<Selection, "isCollapsed" | "rangeCount">;

export interface BlankSurfaceCursorAnchor {
  readonly position: number;
  readonly bias: -1 | 1;
}

type ResolveBlockEndPosition = (block: Element) => number | null;

export function hasNonCollapsedNativeSelection(selection: NativeSelectionState | null): boolean {
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
}

export function shouldHandleBlankSurfaceCursor(
  target: EventTarget | null,
  scroller: HTMLElement | null,
  proseMirror: HTMLElement | null,
  selection: NativeSelectionState | null,
): boolean {
  return (
    isEditorBlankSurface(target, scroller, proseMirror) &&
    !hasNonCollapsedNativeSelection(selection)
  );
}

/**
 * Resolves a root-surface click without encoding knowledge of ProseMirror node
 * types. The caller maps the selected top-level DOM block back to a document
 * position and then asks ProseMirror for the nearest valid text selection.
 */
export function resolveBlankSurfaceCursorAnchor(
  clientY: number,
  proseMirror: HTMLElement,
  documentEnd: number,
  resolveBlockEndPosition: ResolveBlockEndPosition,
): BlankSurfaceCursorAnchor {
  const blocks = Array.from(proseMirror.children).map((element) => ({
    element,
    rect: element.getBoundingClientRect(),
  }));

  if (blocks.length === 0) {
    return { position: documentEnd, bias: -1 };
  }

  const firstBlock = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  if (clientY < firstBlock.rect.top) {
    return { position: 0, bias: 1 };
  }
  if (clientY > lastBlock.rect.bottom) {
    return { position: documentEnd, bias: -1 };
  }

  // A root click in a block's horizontal whitespace belongs to that block;
  // a click in the vertical gap before the next block belongs to the prior one.
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (clientY < block.rect.top) continue;

    const position = resolveBlockEndPosition(block.element);
    if (position !== null) {
      return { position, bias: -1 };
    }
  }

  return { position: 0, bias: 1 };
}
