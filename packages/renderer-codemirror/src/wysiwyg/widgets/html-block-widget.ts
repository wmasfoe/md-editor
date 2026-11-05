/**
 * @file html-block-widget.ts
 * @description HTML 块级内容所见即所得渲染挂件。
 *
 * 遵循 Obsidian / Typora 范式的原位暴露架构（Caret-driven Reveal）：
 * - 单击块体：原子选中整块（支持整体 Backspace 删除与全选，与 Table/Image 规范一致）；
 * - 双击块体或点击「编辑源码」按钮：直接就地原位展开原生多行 HTML 源码；
 * - 方向键导航：键盘上下键滑入时自动展开源码，离开时自动折叠渲染；
 * - 离开态：光标离开该块时，挂件重新挂载并呈现更新后的渲染效果。
 */

import { type EditorView, WidgetType } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { selectWysiwygAtom } from "../blocks/atom-selection.ts";

export interface HtmlBlockWidgetValue {
  readonly recordId: string;
  readonly sanitizedHtml: string;
  readonly placeholder: string | null;
  readonly selected: boolean;
  readonly diagnostics: WysiwygDiagnostics | null;
  readonly rawHtml?: string;
  readonly from?: number;
  readonly to?: number;
}

/**
 * HTMLBlock 挂件组件：在预览态安全渲染 HTML 内容，并支持原子选中与原位就地编辑。
 */
export class HtmlBlockWidget extends WidgetType {
  constructor(readonly value: HtmlBlockWidgetValue) {
    super();
  }

  override eq(other: HtmlBlockWidget): boolean {
    return (
      this.value.recordId === other.value.recordId &&
      this.value.sanitizedHtml === other.value.sanitizedHtml &&
      this.value.placeholder === other.value.placeholder &&
      this.value.selected === other.value.selected &&
      this.value.from === other.value.from &&
      this.value.to === other.value.to
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-html-block-widget";
    wrapper.dataset.recordId = this.value.recordId;
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("tabindex", "-1");
    wrapper.setAttribute("aria-label", "HTML block");
    wrapper.setAttribute("aria-selected", String(this.value.selected));
    if (this.value.selected) {
      wrapper.classList.add("cm-md-html-block-widget--selected");
    }

    const enterEdit = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const pos = Math.min(this.value.from ?? 0, view.state.doc.length);
      view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
      });
      view.focus();
    };

    // 单击块体原子选中整块（支持整块 Delete/Backspace 删除与多选）
    wrapper.addEventListener("click", (event) => {
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(view, this.value.recordId, mouseEvent.metaKey || mouseEvent.ctrlKey);
    });

    // 双击块体直接原位展开源码编辑态
    wrapper.addEventListener("dblclick", enterEdit);

    // 悬浮工具栏（提供清晰的视觉提示「编辑源码」，增强可发现性）
    const toolbarEl = document.createElement("div");
    toolbarEl.className = "cm-md-html-block-widget__toolbar";
    toolbarEl.setAttribute("role", "toolbar");
    toolbarEl.setAttribute("aria-label", "HTML block controls");

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.tabIndex = -1;
    editBtn.className = "cm-md-html-block-widget__btn cm-md-html-block-widget__btn--edit";
    editBtn.setAttribute("aria-label", "编辑 HTML 源码");
    editBtn.textContent = "编辑源码";
    editBtn.addEventListener("click", enterEdit);
    toolbarEl.appendChild(editBtn);

    const contentEl = document.createElement("div");
    contentEl.className = "cm-md-html-block-widget__content";
    if (this.value.placeholder) {
      const placeholder = document.createElement("div");
      placeholder.className = "cm-md-html-block-widget__placeholder";
      placeholder.textContent = this.value.placeholder;
      contentEl.appendChild(placeholder);
    } else {
      contentEl.innerHTML = this.value.sanitizedHtml;
    }

    wrapper.append(toolbarEl, contentEl);
    return wrapper;
  }

  /**
   * 挂件内部事件拦截：避免父编辑器默认鼠标行为在被替换的行上错乱分发
   */
  override ignoreEvent(event: Event): boolean {
    // 允许 click / dblclick 由 widget 自己的监听器处理
    return event.type !== "click" && event.type !== "dblclick";
  }
}
