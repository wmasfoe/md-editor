export interface TocTarget {
  readonly line: number;
  readonly level: number;
  readonly text: string;
  readonly nonce: number;
}

export interface EditorScrollTarget {
  /**
   * Scroll position is restored by ratio because source mode and WYSIWYG mode
   * can render the same Markdown into different visual line heights/counts.
   */
  readonly ratio: number;
  readonly nonce: number;
}

export interface SourceEditorView {
  readonly state: {
    readonly doc: {
      readonly lines: number;
      line(lineNumber: number): { readonly from: number };
      lineAt(position: number): { readonly number: number };
    };
  };
  readonly dom: HTMLElement;
  posAtCoords(coords: { readonly x: number; readonly y: number }): number | null;
  dispatch(transaction: { readonly selection?: { readonly anchor: number } }): void;
  focus(): void;
}
