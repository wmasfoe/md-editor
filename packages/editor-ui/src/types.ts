export interface TocTarget {
  readonly line: number;
  readonly level: number;
  readonly text: string;
  readonly nonce: number;
}

export interface SourceEditorView {
  readonly state: {
    readonly doc: {
      readonly lines: number;
      line(lineNumber: number): { readonly from: number };
    };
  };
  readonly dom: HTMLElement;
  dispatch(transaction: { readonly selection?: { readonly anchor: number } }): void;
  focus(): void;
}
