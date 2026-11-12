/**
 * @file view-operations.ts
 * @description 视图轴开关与选区/滚动操作的协作器（只读写 `RendererViewAdapter`，不触碰协议状态）。
 *
 * 覆盖两类纯视图能力：
 * 1. 视图轴（专注 / 打字机）开关的读取与切换 —— 权威来源是投影层的 StateField，
 *    宿主菜单镜像不得被当成事实源（S1(b)/MED-4）；
 * 2. 选区快照、选区设置、按行滚动 —— 均为零协议副作用的视图操作。
 *
 * 存活性（destroyed）守卫仍由控制器在调用前判定，本模块只负责视图侧语义。
 */

import {
  EditorSelection,
  type EditorState,
  Transaction,
  type Compartment,
  type StateEffect,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import { rendererTransactionOrigin } from "../../origin.ts";
import {
  acceptAiSuggestion,
  aiSuggestionField,
  dismissAiSuggestion,
  setAiSuggestionEffect,
} from "../../wysiwyg/view/suggestion.ts";
import {
  type AiSuggestionValue,
  type AiSuggestionInput,
} from "../../wysiwyg/view/suggestion-model.ts";
import {
  setTypewriterModeEffect,
  typewriterModeField,
} from "../../wysiwyg/input/typewriter-mode.ts";
import { focusModeField, setFocusModeEffect } from "../../wysiwyg/view/focus-mode.ts";
import { revealReplaceInput } from "../../wysiwyg/view/search-panel.ts";
import {
  createMarkdownFormattingKeymap,
  executeFormattingCommand,
} from "../../wysiwyg/editing/markdown-formatting.ts";
import {
  moveBlockUp as moveCmBlockUp,
  moveBlockDown as moveCmBlockDown,
  duplicateBlock as duplicateCmBlock,
  deleteBlock as deleteCmBlock,
} from "../../wysiwyg/blocks/block-move.ts";
import { lintLanguageField, setLintLanguageEffect } from "../../lint/markdown-lint-i18n.ts";
import type { MarkdownLintPortResult, RendererViewAdapter } from "../types.ts";

/**
 * 读取**视图轴**（专注/打字机）当前开关态。
 *
 * 权威来源是渲染层的两个 StateField（见 docs/agent/product/editor_view_modes.md）：
 * 宿主菜单镜像记录的是「最近一次已知勾选态」，因此需要这条「回读真实状态」的通道。
 */
export function readViewModeState(view: RendererViewAdapter): {
  readonly focus: boolean;
  readonly typewriter: boolean;
} {
  return {
    focus: view.state.field(focusModeField, false) === true,
    typewriter: view.state.field(typewriterModeField, false) === true,
  };
}

/** 切换专注模式（纯视图态：dispatch effect 改 StateField，零文档变更）。 */
export function toggleViewFocusMode(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  if (!cmView) {
    return false;
  }
  const next = !cmView.state.field(focusModeField, false);
  cmView.dispatch({ effects: setFocusModeEffect.of(next) });
  return next;
}

/** 切换打字机模式（纯视图态）。 */
export function toggleViewTypewriterMode(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  if (!cmView) {
    return false;
  }
  const next = !cmView.state.field(typewriterModeField, false);
  cmView.dispatch({ effects: setTypewriterModeEffect.of(next) });
  return next;
}

/** Apply undo through the normal renderer transaction pipeline. */
export function undoViewEdit(view: RendererViewAdapter): boolean {
  return undo({
    state: view.state,
    dispatch: (transaction) => view.dispatchTransaction(transaction),
  });
}

/** 读取主选区快照，保留 anchor/head 的选区方向。 */
export function readSelectionSnapshot(view: RendererViewAdapter): {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly head: number;
  readonly anchor: number;
} {
  const selection = view.state.selection.main;
  const text = view.state.doc.sliceString(selection.from, selection.to);
  return {
    from: selection.from,
    to: selection.to,
    text,
    head: selection.head,
    anchor: selection.anchor,
  };
}

/**
 * 设置编辑器选区(编辑器标准能力,供宿主定位/测试)。
 * from === to 时为光标;范围按文档长度钳制。
 */
export function setViewSelection(view: RendererViewAdapter, from: number, to: number): void {
  const length = view.state.doc.length;
  const clampedFrom = Math.max(0, Math.min(from, length));
  const clampedTo = Math.max(0, Math.min(to, length));
  view.dispatch({
    selection: EditorSelection.create(
      clampedFrom === clampedTo
        ? [EditorSelection.cursor(clampedFrom)]
        : [EditorSelection.range(clampedFrom, clampedTo)],
    ),
    scrollIntoView: true,
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select",
  });
}

/**
 * 滚动到指定行(1-based)并可将光标定位到行首。
 * line 范围自动按文档总行数钳制。
 */
export function scrollViewToLine(
  view: RendererViewAdapter,
  line: number,
  options?: { readonly select?: boolean; readonly focus?: boolean },
): boolean {
  const totalLines = view.state.doc.lines;
  if (totalLines <= 0) {
    return false;
  }
  const clampedLine = Math.max(1, Math.min(Math.floor(line), totalLines));
  const lineInfo = view.state.doc.line(clampedLine);
  const pos = lineInfo.from;
  const select = options?.select ?? true;
  const focus = options?.focus ?? true;

  view.dispatch({
    ...(select ? { selection: EditorSelection.cursor(pos) } : {}),
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }),
    annotations: Transaction.addToHistory.of(false),
    userEvent: "select.pointer",
  });

  if (focus) {
    view.focus();
  }
  return true;
}

/** Flush native DOM/widget edits only while the controller's view is alive. */
export function flushPendingViewEdits(view: RendererViewAdapter, destroyed: boolean): boolean {
  if (destroyed) {
    return false;
  }
  return view.flushPendingEdits?.() ?? false;
}

/** 执行 Markdown 常用格式化命令 */
export function executeViewFormatting(view: RendererViewAdapter, commandId: string): boolean {
  const cmView = view as unknown as EditorView | null;
  if (!cmView) {
    return false;
  }
  return executeFormattingCommand(cmView, commandId);
}

/** 打开文档内查找面板 */
export function openViewFind(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  if (!cmView) {
    return false;
  }
  return openSearchPanel(cmView);
}

/**
 * 打开文档内替换面板，展开替换行并聚焦替换输入框。
 *
 * `openSearchPanel` 在面板已打开时只会聚焦查找框，因此无论返回值如何都要再展开替换行。
 * 面板 mount 会同步聚焦查找框，微任务和下一帧再聚焦一次，避免被那次聚焦盖掉。
 */
export function openViewReplace(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  if (!cmView) {
    return false;
  }
  const opened = openSearchPanel(cmView);
  const root = cmView.dom;
  if (!root?.querySelector) {
    return opened;
  }
  const revealed = revealReplaceInput(root);
  const refocus = () => {
    revealReplaceInput(root);
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(refocus);
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(refocus);
  }
  return opened || revealed;
}

import {
  clearMarkdownLintCommand,
  collectPreservedNonMarkdownDiagnostics,
  fixAllMarkdownLintIssues,
  runMarkdownLint,
  runMarkdownLintCommand,
  type MarkdownLintFixAllResult,
  type MarkdownLintRunResult,
} from "../../lint/index.ts";

/** 块操作：上移当前块 */
export function moveViewBlockUp(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  return Boolean(cmView && moveCmBlockUp(cmView));
}

/** 块操作：下移当前块 */
export function moveViewBlockDown(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  return Boolean(cmView && moveCmBlockDown(cmView));
}

/** 块操作：复制当前块 */
export function duplicateViewBlock(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  return Boolean(cmView && duplicateCmBlock(cmView));
}

/** 块操作：删除当前块 */
export function deleteViewBlock(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  return Boolean(cmView && deleteCmBlock(cmView));
}

/** 动态重配格式化快捷键 */
export function setFormattingViewKeymaps(
  view: RendererViewAdapter,
  compartment: Compartment,
  customKeymaps: ReadonlyMap<string, string>,
): void {
  const cmView = view as unknown as EditorView | null;
  if (cmView) {
    cmView.dispatch({
      effects: compartment.reconfigure(createMarkdownFormattingKeymap(customKeymaps)),
    });
  }
}

/** 执行 markdownlint 诊断分析 */
export function runViewMarkdownLint(
  view: RendererViewAdapter,
  config?: Record<string, unknown>,
): MarkdownLintRunResult {
  const target = view.editorView ?? (view as unknown as EditorView);
  return runMarkdownLintCommand(target, config);
}

/** 执行 markdownlint 全部自动修复 */
export function fixAllViewMarkdownLint(
  view: RendererViewAdapter,
  config?: Record<string, unknown>,
): MarkdownLintFixAllResult {
  const target = view.editorView ?? (view as unknown as EditorView);
  return fixAllMarkdownLintIssues(target, config);
}

/** 清理 markdownlint 诊断结果 */
export function clearViewMarkdownLint(view: RendererViewAdapter): void {
  const target = view.editorView ?? (view as unknown as EditorView);
  clearMarkdownLintCommand(target);
}

/** 采纳 AI 续写建议 */
export function acceptViewAiSuggestion(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  return Boolean(cmView && acceptAiSuggestion(cmView));
}

/** 放弃 AI 续写建议 */
export function dismissViewAiSuggestion(view: RendererViewAdapter): boolean {
  const cmView = view as unknown as EditorView | null;
  return Boolean(cmView && dismissAiSuggestion(cmView));
}

/** 读取当前 AI 建议内容 */
export function readViewAiSuggestion(view: RendererViewAdapter): AiSuggestionValue | null {
  return view.state.field(aiSuggestionField, false) ?? null;
}

/** 重新计算并在视图上派发 Markdown 诊断标记 */
export function recomputeViewMarkdownLint(view: RendererViewAdapter): void {
  const preserved = collectPreservedNonMarkdownDiagnostics(view.state);
  const mdDiagnostics = runMarkdownLint(view.state);
  const effects = (setDiagnostics(view.state, [...preserved, ...mdDiagnostics]).effects ??
    []) as readonly StateEffect<unknown>[];
  view.dispatch({
    effects: [...effects],
    annotations: [
      Transaction.addToHistory.of(false),
      rendererTransactionOrigin.of({ kind: "markdown-lint" }),
    ],
  });
}

/** 收集清理 Markdown 诊断时的保留效果 */
export function createMarkdownLintClearEffects(
  state: EditorState,
): readonly StateEffect<unknown>[] {
  return (
    (setDiagnostics(state, collectPreservedNonMarkdownDiagnostics(state))
      .effects as readonly StateEffect<unknown>[]) ?? []
  );
}

/** Language is view configuration: preserve document/history and refresh only active lint. */
export function setViewLanguage(
  view: RendererViewAdapter,
  language: string | undefined,
  lintEnabled: boolean,
): MarkdownLintPortResult {
  if (view.state.field(lintLanguageField) === language) return { status: "noop" };
  view.dispatch({
    effects: setLintLanguageEffect.of(language),
    annotations: [
      Transaction.addToHistory.of(false),
      rendererTransactionOrigin.of({ kind: "markdown-lint" }),
    ],
  });
  if (lintEnabled) recomputeViewMarkdownLint(view);
  return { status: "applied" };
}

/** Present a suggestion through the same view pipeline as accept/dismiss. */
export function showViewAiSuggestion(
  view: RendererViewAdapter,
  suggestion: AiSuggestionInput,
): void {
  view.dispatch({ effects: setAiSuggestionEffect.of(suggestion) });
  view.focus();
}
