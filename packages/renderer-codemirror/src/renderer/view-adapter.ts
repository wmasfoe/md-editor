/**
 * @file view-adapter.ts
 * @description 渲染器视图适配层：把 CodeMirror `EditorView` 收敛到 `RendererViewAdapter` 窄接口，
 * 并维护 renderer → controller 的所属关系登记（`controllerByRenderer`）。
 *
 * 控制器不直接依赖本模块（仅 `index.ts` 的工厂在装配时使用 `DomRendererViewAdapter`），
 * 反向的 controller 引用是 **type-only**，因此本模块与 `controller` 之间无运行期环。
 */

import type { EditorState, StateEffect, Transaction, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flushActiveTableCell } from "../wysiwyg/widgets/table/index.ts";
import type { CodeMirrorRendererController } from "./controller.ts";
import type { CodeMirrorRenderer, RendererViewAdapter, RendererViewFactoryInput } from "./types.ts";

export class DomRendererViewAdapter implements RendererViewAdapter {
  readonly #view: EditorView;

  constructor(input: RendererViewFactoryInput) {
    this.#view = new EditorView({ state: input.state, parent: input.parent });
  }

  get state(): EditorState {
    return this.#view.state;
  }

  get isComposing(): boolean {
    return this.#view.compositionStarted;
  }

  dispatch(spec: TransactionSpec): void {
    this.#view.dispatch(spec);
  }

  dispatchTransaction(transaction: Transaction): void {
    this.#view.dispatch(transaction);
  }

  setState(state: EditorState): void {
    this.#view.setState(state);
  }

  scrollSnapshot(): StateEffect<unknown> {
    return this.#view.scrollSnapshot();
  }

  getScrollTop(): number {
    return this.#view.scrollDOM.scrollTop;
  }

  setScrollTop(value: number): void {
    this.#view.scrollDOM.scrollTop = value;
  }

  getCursorCoordinates(pos: number): {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  } | null {
    const coords = this.#view.coordsAtPos(pos);
    if (!coords) {
      return null;
    }
    return {
      top: coords.top,
      bottom: coords.bottom,
      left: coords.left,
      right: coords.right,
    };
  }

  getViewportRect(): {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  } | null {
    const rect = this.#view.scrollDOM.getBoundingClientRect?.();
    if (!rect) {
      return null;
    }
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
    };
  }

  getLineBlockTop(pos: number): number | null {
    try {
      const clampedPos = Math.max(0, Math.min(pos, this.#view.state.doc.length));
      return this.#view.lineBlockAt(clampedPos).top;
    } catch {
      return null;
    }
  }

  hasFocus(): boolean {
    return this.#view.hasFocus;
  }

  focus(): void {
    this.#view.focus();
  }

  requestMeasure(afterMeasure?: () => void): void {
    this.#view.requestMeasure();
    if (afterMeasure) {
      const frame = this.#view.dom.ownerDocument.defaultView;
      if (frame) {
        frame.requestAnimationFrame(afterMeasure);
      } else {
        queueMicrotask(afterMeasure);
      }
    }
  }

  clearDomSelection(): void {
    const dom = this.#view.contentDOM;
    const win = dom.ownerDocument?.defaultView;
    const sel = win?.getSelection();
    if (sel && sel.rangeCount > 0) {
      sel.removeAllRanges();
    }
    const internalView = this.#view as unknown as {
      observer?: {
        clearSelectionRange?: () => void;
        clear?: () => void;
      };
      inputState?: {
        mouseSelection?: { destroy?: () => void } | null;
        draggedContent?: unknown;
        lastSelectionTime?: number;
        lastSelectionOrigin?: unknown;
      };
    };
    internalView.observer?.clearSelectionRange?.();
    internalView.observer?.clear?.();
    if (internalView.inputState?.mouseSelection) {
      internalView.inputState.mouseSelection.destroy?.();
      internalView.inputState.mouseSelection = null;
    }
    if (internalView.inputState) {
      internalView.inputState.draggedContent = null;
      internalView.inputState.lastSelectionTime = 0;
      internalView.inputState.lastSelectionOrigin = null;
    }
    if (this.#view.hasFocus) {
      this.#view.focus();
    }
  }

  flushPendingEdits(): boolean {
    return flushActiveTableCell(this.#view);
  }

  destroy(): void {
    this.#view.destroy();
  }
}

/** renderer → controller 的所属关系（门面是冻结对象，只有此处能反查内部控制器）。 */
export const controllerByRenderer = new WeakMap<CodeMirrorRenderer, CodeMirrorRendererController>();
