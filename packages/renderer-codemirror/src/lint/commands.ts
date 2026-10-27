/**
 * @fileoverview Markdown 规范检查与一键批量修复命令
 */

import { Transaction, type EditorState } from "@codemirror/state";
import { openLintPanel, closeLintPanel, setDiagnostics } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { lint as lintMarkdownSync } from "markdownlint/sync";
import { authorizeWysiwygProtectedChange } from "../wysiwyg/state/change-authorization.ts";
import { markdownRangeIndexField } from "../markdown/range-index.ts";
import {
  convertFixInfoToChange,
  DEFAULT_MARKDOWNLINT_CONFIG,
  EXEMPT_SYNTAX_KINDS,
  runMarkdownLint,
  type MarkdownLintTextChange,
} from "./markdown-lint.ts";

export type { MarkdownLintTextChange };

export interface MarkdownLintRunResult {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
}

export interface MarkdownLintFixAllResult {
  readonly appliedCount: number;
  readonly remainingCount: number;
}

/**
 * 收集当前文档中所有可自动修复的变更项（过滤 Frontmatter、Math、MDX 豁免区）
 */
export function collectFixableMarkdownLintChanges(
  state: EditorState,
  config?: Record<string, unknown>,
): readonly MarkdownLintTextChange[] {
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
    const changes: MarkdownLintTextChange[] = [];
    const rangeIndex = state.field(markdownRangeIndexField, false);

    for (const issue of issues) {
      if (!issue.fixInfo) {
        continue;
      }

      const lineNum = Math.min(Math.max(1, issue.lineNumber), state.doc.lines);
      const line = state.doc.line(lineNum);
      let from = line.from;
      let to = line.to;

      if (issue.errorRange && issue.errorRange.length >= 2) {
        const [col, length] = issue.errorRange;
        from = Math.min(line.from + Math.max(0, col - 1), line.to);
        to = Math.min(from + Math.max(1, length), line.to);
      }

      if (rangeIndex) {
        const overlapping = rangeIndex.overlapping(from, to);
        if (overlapping.some((record) => EXEMPT_SYNTAX_KINDS.has(record.kind))) {
          continue;
        }
      }

      const change = convertFixInfoToChange(state.doc, issue.fixInfo, lineNum);
      changes.push(change);
    }

    return changes;
  } catch (error) {
    console.warn("MarkdownLint 批量收集修复项异常:", error);
    return [];
  }
}

/**
 * 过滤出互不重叠且按文档绝对位置降序排列的变更集
 * 采用从后往前的倒序排序（Bottom-to-Top），保证前面的字符索引在修改后绝对有效
 */
export function filterNonOverlappingDescendingChanges(
  changes: readonly MarkdownLintTextChange[],
): readonly MarkdownLintTextChange[] {
  if (changes.length <= 1) {
    return changes;
  }

  // 1. 按 from 降序排列；若 from 相同则按 to 降序排列
  const sorted = changes.toSorted((a, b) => {
    if (b.from !== a.from) {
      return b.from - a.from;
    }
    return b.to - a.to;
  });

  // 2. 倒序筛选，排除重叠区域（后方变更不可侵入已选定的前方起点）
  const result: MarkdownLintTextChange[] = [];
  let minAcceptedFrom = Infinity;

  for (const change of sorted) {
    if (change.to <= minAcceptedFrom) {
      result.push(change);
      minAcceptedFrom = change.from;
    }
  }

  return result;
}

/**
 * 运行单次 Markdown 规范检查命令：
 * 分发诊断至编辑器，并呼出底部问题面板供逐项查看与跳转
 */
export function runMarkdownLintCommand(
  view: EditorView,
  config?: Record<string, unknown>,
): MarkdownLintRunResult {
  const diagnostics = runMarkdownLint(view.state, config);
  view.dispatch(setDiagnostics(view.state, diagnostics));

  if (diagnostics.length > 0 && typeof view.plugin === "function") {
    try {
      openLintPanel(view);
    } catch {
      // 容错：无 DOM 真实宿主或测试 mock 视口下安全跳过面板挂载
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  return {
    total: diagnostics.length,
    errors,
    warnings,
  };
}

const MAX_FIX_ALL_PASSES = 5;

/**
 * 执行一键修复全部 Markdown 规范问题命令：
 * - 倒序安全应用所有 fixInfo
 * - 多轮级联收敛（最多 5 轮）
 * - 单次 Undo 历史（单步 Cmd+Z 即可全部撤回）
 * - 刷新诊断状态，若无残留问题自动关闭问题面板
 */
export function fixAllMarkdownLintIssues(
  view: EditorView,
  config?: Record<string, unknown>,
): MarkdownLintFixAllResult {
  let appliedCount = 0;
  let passes = 0;

  while (passes < MAX_FIX_ALL_PASSES) {
    const changes = collectFixableMarkdownLintChanges(view.state, config);
    if (changes.length === 0) {
      break;
    }

    const nonOverlapping = filterNonOverlappingDescendingChanges(changes);
    if (nonOverlapping.length === 0) {
      break;
    }

    view.dispatch({
      changes: nonOverlapping.map((c) => ({ from: c.from, to: c.to, insert: c.insert })),
      userEvent: "lint.fix.all",
      annotations: [Transaction.addToHistory.of(true), authorizeWysiwygProtectedChange.of(true)],
    });

    appliedCount += nonOverlapping.length;
    passes += 1;
  }

  // 修复完成后重新计算诊断，刷新波浪线
  const remaining = runMarkdownLint(view.state, config);
  view.dispatch(setDiagnostics(view.state, remaining));

  if (remaining.length === 0 && typeof view.plugin === "function") {
    try {
      closeLintPanel(view);
    } catch {
      // 容错：无 DOM 真实宿主或测试 mock 视口下安全跳过
    }
  }

  return {
    appliedCount,
    remainingCount: remaining.length,
  };
}
