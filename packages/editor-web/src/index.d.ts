export interface PlaygroundOptions {
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
  /** Base URL used by GPUI when it requests bundled assets. */
  assetBasePath?: string;
}

export interface PlaygroundEditor {
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  /**
   * 把当前 Markdown 写入系统剪贴板。
   *
   * 由 Rust 侧的 `Platform::write_to_clipboard` 实现。浏览器要求写剪贴板
   * 发生在用户激活（点击）的同步栈内，所以请在 click 处理函数里直接调用。
   */
  copyMarkdown(): void;
  setReadonly(readonly: boolean): void;
  dispose(): void;
}

/** Starts GPUI Web and resolves after the shared editor has mounted. */
export function mountPlayground(options?: PlaygroundOptions): Promise<PlaygroundEditor>;
