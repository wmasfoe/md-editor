export interface PlaygroundOptions {
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
  /** Base URL used by GPUI when it requests bundled assets. */
  assetBasePath?: string;
}

export interface PlaygroundEditor {
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  setReadonly(readonly: boolean): void;
  dispose(): void;
}

/** Starts GPUI Web and resolves after the shared editor has mounted. */
export function mountPlayground(options?: PlaygroundOptions): Promise<PlaygroundEditor>;
