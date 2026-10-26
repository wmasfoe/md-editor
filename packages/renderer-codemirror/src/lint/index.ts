import { Facet, type Extension, type EditorState, type TransactionSpec } from "@codemirror/state";
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { runLinkValidation } from "./link-lint.ts";
import type { DocumentLinterOptions, LinkLintOptions } from "./types.ts";

export * from "./types.ts";
export { runLinkValidation } from "./link-lint.ts";

/**
 * 链接检查探针选项 Facet
 */
export const linkLintOptionsFacet = Facet.define<LinkLintOptions, LinkLintOptions>({
  combine(values) {
    return values.at(-1) ?? {};
  },
});

/**
 * 提供 CM6 原生 Lint 支持（包含行号槽标记与 F2 / Shift+F2 导航快捷键）
 */
export function createLintExtensions(): Extension {
  return [lintGutter(), keymap.of(lintKeymap)];
}

/**
 * 执行完整的 Markdown 格式与本地链接检查，并将结果分发至 EditorView
 */
export async function executeDocumentLint(
  view: { readonly state: EditorState; dispatch(spec: TransactionSpec): void },
  options: DocumentLinterOptions = {},
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (options.enableMarkdownLint !== false) {
    const { runMarkdownLint } = await import("./markdown-lint.ts");
    const mdDiagnostics = runMarkdownLint(view.state, options.markdownlintConfig);
    diagnostics.push(...mdDiagnostics);
  }

  if (options.enableLinkCheck !== false && options.validateLinks) {
    const linkDiagnostics = await runLinkValidation(view.state, options);
    diagnostics.push(...linkDiagnostics);
  }

  view.dispatch(setDiagnostics(view.state, diagnostics));
  return diagnostics;
}
