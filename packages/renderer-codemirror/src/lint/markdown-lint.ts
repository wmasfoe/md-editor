import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { lint as lintMarkdownSync } from "markdownlint/sync";
import { createDiagnosticDomNode } from "./diagnostic-dom.ts";
import {
  MARKDOWNLINT_ZH_RULES,
  getActiveLintLocale,
  localizeMarkdownLintDetail,
} from "./markdown-lint-i18n.ts";

export const DEFAULT_MARKDOWNLINT_CONFIG: Record<string, unknown> = {
  default: true,
  "line-length": false, // MD013: 写作时允许长行
  "no-inline-html": false, // MD033: 允许 HTML/MDX 标签
  "first-line-heading": false, // MD041: 允许第一行不是标题
  "single-trailing-newline": false, // MD047: 编辑器内部不强求尾部换行
  "no-trailing-spaces": false, // MD009: 写作交互中允许尾部临时空格（避免键入过程中产生骚扰性红线）
  "no-hard-tabs": false, // MD010: 允许使用制表符缩进
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

      const ruleCode = issue.ruleNames[0] ?? "Lint";
      const ruleAlias = issue.ruleNames[1];
      const severity = issue.severity === "error" ? "error" : "warning";

      const activeLocale = getActiveLintLocale();
      const isZh = activeLocale === "zh" || activeLocale === "zh-Hant";
      const zhInfo = isZh ? MARKDOWNLINT_ZH_RULES[ruleCode] : undefined;
      const displayAlias = zhInfo?.alias ?? ruleAlias ?? ruleCode;
      const displayDesc = zhInfo?.description ?? issue.ruleDescription;
      const displayDetail = isZh
        ? localizeMarkdownLintDetail(issue.errorDetail ?? undefined)
        : (issue.errorDetail ?? undefined);

      diagnostics.push({
        from,
        to,
        severity,
        source: "markdownlint",
        message: `[${ruleCode}/${displayAlias}] ${displayDesc}${
          displayDetail ? ` (${displayDetail})` : ""
        }`,
        renderMessage: () =>
          createDiagnosticDomNode({
            ruleCode,
            ruleAlias,
            description: issue.ruleDescription,
            detail: issue.errorDetail ?? undefined,
            severity,
            locale: activeLocale,
          }) as unknown as Node,
      });
    }

    return diagnostics;
  } catch (error) {
    console.warn("MarkdownLint 执行异常:", error);
    return [];
  }
}
