import { Transaction, type EditorState } from "@codemirror/state";
import type { Action, Diagnostic } from "@codemirror/lint";
import { lint as lintMarkdownSync } from "markdownlint/sync";
import { authorizeWysiwygProtectedChange } from "../wysiwyg/state/change-authorization.ts";
import { createDiagnosticDomNode } from "./diagnostic-dom.ts";
import {
  MARKDOWNLINT_ZH_RULES,
  describeFixInfoInChinese,
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

      // 优先从纯结构化的 fixInfo 状态字段生成地道中文建议，避免依赖脆弱正则
      const fixDescription =
        issue.fixInfo && isZh ? describeFixInfoInChinese(issue.fixInfo) : undefined;
      const displayDetail =
        fixDescription ??
        (isZh
          ? localizeMarkdownLintDetail(issue.errorDetail ?? undefined)
          : (issue.errorDetail ?? undefined));

      // 若 markdownlint 返回了自动修复元数据，挂载 CodeMirror Action
      const actions: Action[] = [];
      if (issue.fixInfo) {
        const fix = issue.fixInfo;
        actions.push({
          name: isZh ? "一键修复" : "Fix",
          apply: (view) => {
            const fixLineNum = Math.min(
              Math.max(1, fix.lineNumber ?? lineNum),
              view.state.doc.lines,
            );
            const targetLine = view.state.doc.line(fixLineNum);
            const deleteCount = fix.deleteCount ?? 0;

            if (deleteCount === -1) {
              const lineFrom = targetLine.from;
              const lineTo =
                fixLineNum < view.state.doc.lines
                  ? view.state.doc.line(fixLineNum + 1).from
                  : targetLine.to;
              view.dispatch({
                changes: { from: lineFrom, to: lineTo, insert: "" },
                userEvent: "lint.fix",
                annotations: [
                  Transaction.addToHistory.of(true),
                  authorizeWysiwygProtectedChange.of(true),
                ],
              });
            } else {
              const editColumn = Math.max(1, fix.editColumn ?? 1);
              const editFrom = Math.min(targetLine.from + editColumn - 1, targetLine.to);
              const editTo = Math.min(editFrom + deleteCount, targetLine.to);
              const insertText = fix.insertText ?? "";
              view.dispatch({
                changes: { from: editFrom, to: editTo, insert: insertText },
                userEvent: "lint.fix",
                annotations: [
                  Transaction.addToHistory.of(true),
                  authorizeWysiwygProtectedChange.of(true),
                ],
              });
            }
          },
        });
      }

      diagnostics.push({
        from,
        to,
        severity,
        source: "markdownlint",
        message: `[${ruleCode}/${displayAlias}] ${displayDesc}${
          displayDetail ? ` (${displayDetail})` : ""
        }`,
        actions,
        renderMessage: () =>
          createDiagnosticDomNode({
            ruleCode,
            ruleAlias,
            description: issue.ruleDescription,
            detail: displayDetail,
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
