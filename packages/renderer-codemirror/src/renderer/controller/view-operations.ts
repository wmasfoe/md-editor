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

import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  setTypewriterModeEffect,
  typewriterModeField,
} from "../../wysiwyg/input/typewriter-mode.ts";
import { focusModeField, setFocusModeEffect } from "../../wysiwyg/view/focus-mode.ts";
import type { RendererViewAdapter } from "../types.ts";

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

/** 读取主选区快照（from/to/text/head）。 */
export function readSelectionSnapshot(view: RendererViewAdapter): {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly head: number;
} {
  const selection = view.state.selection.main;
  const text = view.state.doc.sliceString(selection.from, selection.to);
  return {
    from: selection.from,
    to: selection.to,
    text,
    head: selection.head,
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
