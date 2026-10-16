/**
 * @file mode-viewport.ts
 * @description 模式切换的视口/光标记忆与恢复协作器。
 *
 * 职责：切换编辑器模式（WYSIWYG ↔ Source）时记忆每个模式的滚动位置与光标位置，
 * 并在切换后做像素级几何对齐（光标相对视口顶部的偏移）或回落到记忆位置。
 *
 * 状态（两个 Map 与恢复序列）仍由 `CodeMirrorRendererController` 持有；本模块
 * 只通过显式上下文读写，避免控制器与协作器之间出现运行期环。
 */

import { Transaction, type Compartment } from "@codemirror/state";
import type { EditorMode } from "@md-editor/editor-core";
import { createModeExtensions, setEditorModeEffect } from "../../mode.ts";
import { rendererTransactionOrigin, type RendererTransactionOrigin } from "../../origin.ts";
import type { RendererViewAdapter } from "../types.ts";

export interface ModeViewportContext {
  readonly view: RendererViewAdapter;
  readonly modeCompartment: Compartment;
  readonly scrollTopsByMode: Map<EditorMode, number>;
  readonly cursorPosByMode: Map<EditorMode, number>;
  readonly currentMode: () => EditorMode;
  readonly documentGeneration: () => number;
  readonly isDestroyed: () => boolean;
  /** 递增并返回"模式恢复"序列号（防过期 measure 回调覆盖用户滚动）。 */
  readonly beginRestoreSequence: () => number;
  readonly isCurrentRestore: (sequence: number) => boolean;
  readonly requestMeasure: (afterMeasure: () => void) => void;
}

export function dispatchModeChangeWithMemory(
  ctx: ModeViewportContext,
  mode: EditorMode,
  origin: RendererTransactionOrigin,
): void {
  const previousMode = ctx.currentMode();
  const previousScrollTop = ctx.view.getScrollTop();
  const cursorPos = ctx.view.state.selection.main.head;
  const initialCoords = ctx.view.getCursorCoordinates?.(cursorPos) ?? null;
  const initialViewport = ctx.view.getViewportRect?.() ?? null;

  // 记录切换前模式的滚动位置与光标位置
  ctx.scrollTopsByMode.set(previousMode, previousScrollTop);
  ctx.cursorPosByMode.set(previousMode, cursorPos);

  // 检测光标在切换前是否处于当前可视视口内部：
  // 若处于视口内，记录光标相对于视口顶部的相对偏移量（用于模式切换后像素级几何对齐）；
  // 若光标在视口外（如用户滚动至其他段落阅读），则不强行吸附光标，维持原视口阅读位置。
  let cursorOffsetPx: number | null = null;
  if (
    initialCoords !== null &&
    initialViewport !== null &&
    initialViewport.bottom > initialViewport.top
  ) {
    if (
      initialCoords.bottom >= initialViewport.top &&
      initialCoords.top <= initialViewport.bottom
    ) {
      cursorOffsetPx = initialCoords.top - initialViewport.top;
    }
  }

  // 判断目标模式是否已有精确记录且光标未发生位移（例如 WYSIWYG -> Source -> WYSIWYG 原路切回）
  const hasPriorModeRecord = ctx.scrollTopsByMode.has(mode);
  const cursorUnchanged = ctx.cursorPosByMode.get(mode) === cursorPos;
  const priorScrollTop =
    hasPriorModeRecord && cursorUnchanged ? ctx.scrollTopsByMode.get(mode)! : null;

  const scrollSnapshot = ctx.view.scrollSnapshot();
  ctx.view.dispatch({
    effects: [
      setEditorModeEffect.of(mode),
      ctx.modeCompartment.reconfigure(createModeExtensions(mode)),
      scrollSnapshot,
    ],
    annotations: [Transaction.addToHistory.of(false), rendererTransactionOrigin.of(origin)],
  });

  if (priorScrollTop !== null) {
    ctx.view.setScrollTop(priorScrollTop);
  } else if (cursorOffsetPx === null) {
    ctx.view.setScrollTop(previousScrollTop);
  }

  const generation = ctx.documentGeneration();
  const restoreSequence = ctx.beginRestoreSequence();
  ctx.requestMeasure(() => {
    if (
      !ctx.isDestroyed() &&
      ctx.documentGeneration() === generation &&
      ctx.currentMode() === mode &&
      ctx.isCurrentRestore(restoreSequence)
    ) {
      if (priorScrollTop !== null) {
        ctx.view.setScrollTop(priorScrollTop);
        return;
      }

      if (cursorOffsetPx !== null) {
        const currentHead = ctx.view.state.selection.main.head;
        const newCoords = ctx.view.getCursorCoordinates?.(currentHead) ?? null;
        const newViewport = ctx.view.getViewportRect?.() ?? null;
        if (newCoords !== null && newViewport !== null) {
          const currentOffset = newCoords.top - newViewport.top;
          const delta = currentOffset - cursorOffsetPx;
          if (Math.abs(delta) >= 1) {
            const currentScroll = ctx.view.getScrollTop();
            const targetScroll = Math.max(0, currentScroll + delta);
            ctx.view.setScrollTop(targetScroll);
            ctx.scrollTopsByMode.set(mode, targetScroll);
          } else {
            ctx.scrollTopsByMode.set(mode, ctx.view.getScrollTop());
          }
          return;
        }
        const blockTop = ctx.view.getLineBlockTop?.(currentHead);
        if (typeof blockTop === "number") {
          const targetScrollTop = Math.max(0, blockTop - cursorOffsetPx);
          ctx.view.setScrollTop(targetScrollTop);
          ctx.scrollTopsByMode.set(mode, targetScrollTop);
          return;
        }
      }

      ctx.view.setScrollTop(previousScrollTop);
    }
  });
}
