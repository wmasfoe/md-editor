import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { lint as lintMarkdownSync } from "markdownlint/sync";

export const DEFAULT_MARKDOWNLINT_CONFIG: Record<string, unknown> = {
  default: true,
  "line-length": false, // MD013: 写作时允许长行
  "no-inline-html": false, // MD033: 允许 HTML/MDX 标签
  "first-line-heading": false, // MD041: 允许第一行不是标题
  "single-trailing-newline": false, // MD047: 编辑器内部不强求尾部换行
};

/**
 * 对编辑器中的 Markdown 内容执行同步静态规则检查
 */
export function runMarkdownLint(
  state: EditorState,
  config?: Record<string, unknown>,
): Diagnostic[] {
  const text = state.doc.toString();
  if (!text.trim()) {
    return [];
  }

  const mergedConfig = {
    ...DEFAULT_MARKDOWNLINT_CONFIG,
    ...config,
  };

  try {
    const result = lintMarkdownSync({
      strings: { content: text },
      config: mergedConfig,
    });

    const issues = result.content ?? [];
    const diagnostics: Diagnostic[] = [];

    for (const issue of issues) {
      const lineNum = Math.min(Math.max(1, issue.lineNumber), state.doc.lines);
      const line = state.doc.line(lineNum);

      let from = line.from;
      let to = line.to;

      if (issue.errorRange && issue.errorRange.length >= 2) {
        const [col, length] = issue.errorRange;
        from = Math.min(line.from + Math.max(0, col - 1), line.to);
        to = Math.min(from + Math.max(1, length), line.to);
      }

      if (from === to && from < line.to) {
        to = from + 1;
      }

      diagnostics.push({
        from,
        to,
        severity: issue.severity === "error" ? "error" : "warning",
        message: `[${issue.ruleNames.join("/")}] ${issue.ruleDescription}${
          issue.errorDetail ? ` (${issue.errorDetail})` : ""
        }`,
      });
    }

    return diagnostics;
  } catch (error) {
    console.warn("MarkdownLint 执行异常:", error);
    return [];
  }
}
