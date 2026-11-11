/**
 * @file html-block-widget.ts
 * @description HTML 块级内容所见即所得渲染挂件。
 *
 * - 单击卡片空白：原子选中整块（Backspace 删除、与表格/图片一致）；
 * - 单击预览里的链接：打开链接，不选中整块；
 * - 双击或「编辑源码」：在父文档里原位展开源码。方向键不展开。
 * - 预览挂载走 DOMParser + 节点重建，不用 innerHTML。
 */

import { type EditorView, WidgetType } from "@codemirror/view";
import type { WysiwygDiagnostics } from "../../diagnostics.ts";
import { selectWysiwygAtom } from "../blocks/atom-selection.ts";
import { isSafeLinkTarget, openLinkTargetFacet } from "../view/link-interaction.ts";

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
      mountSanitizedHtml(document, contentEl, this.value.sanitizedHtml);
    }

    // 单击卡片空白才原子选中。预览里的链接和表单控件保持自己的行为。
    wrapper.addEventListener("click", (event) => {
      if (handlePreviewContentClick(event, view, contentEl)) {
        return;
      }
      const mouseEvent = event as MouseEvent;
      selectWysiwygAtom(view, this.value.recordId, mouseEvent.metaKey || mouseEvent.ctrlKey);
    });

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

const PREVIEW_INTERACTIVE_SELECTOR = "a, button, summary, input, textarea, select, label";

/**
 * 预览内容区里的交互元素不选中整块。
 * 安全链接交给宿主打开；`<details>` 等保留浏览器默认行为。
 * @returns 这次点击已经被预览内容消费。
 */
function handlePreviewContentClick(event: Event, view: EditorView, content: HTMLElement): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !content.contains(target)) {
    return false;
  }
  const interactive = target.closest(PREVIEW_INTERACTIVE_SELECTOR);
  if (!interactive || !content.contains(interactive)) {
    return false;
  }
  event.stopPropagation();
  const anchor = target.closest("a");
  if (!anchor || !content.contains(anchor)) {
    return true;
  }
  event.preventDefault();
  const href = anchor.getAttribute("href");
  const open = view.state.facet(openLinkTargetFacet);
  if (href && isSafeLinkTarget(href) && open) {
    open(href);
  }
  return true;
}

/**
 * 第二层纵深：字符串清洗之后仍用 DOMParser 重建节点。
 * 浏览器解析器里才会复活的残片在这里变成文本，不会再走 innerHTML。
 */
function mountSanitizedHtml(document: Document, parent: HTMLElement, html: string): void {
  const nodes = parseAndRebuildHtml(document, html);
  if (!nodes) {
    parent.textContent = html;
    return;
  }
  parent.append(...nodes);
}

function parseAndRebuildHtml(document: Document, htmlText: string): Node[] | null {
  const Parser =
    document.defaultView?.DOMParser ?? (typeof DOMParser === "undefined" ? null : DOMParser);
  if (!Parser) {
    return null;
  }
  const parsed = new Parser().parseFromString(`<body>${htmlText}</body>`, "text/html");
  return Array.from(parsed.body.childNodes).map((node) => rebuildNode(document, node));
}

function rebuildNode(document: Document, source: Node): Node {
  if (source.nodeType === 3) {
    return document.createTextNode(source.nodeValue ?? "");
  }
  if (source.nodeType !== 1) {
    return document.createTextNode("");
  }

  const sourceElement = source as Element;
  const tagName = sourceElement.tagName.toLowerCase();
  if (tagName === "script" || tagName === "iframe" || tagName === "object" || tagName === "embed") {
    return document.createTextNode("");
  }

  const element = document.createElement(tagName);
  for (const attribute of Array.from(sourceElement.attributes)) {
    const attrName = attribute.name.toLowerCase();
    if (attrName.startsWith("on")) {
      continue;
    }
    if (
      (attrName === "href" || attrName === "src") &&
      /^(javascript|vbscript):/i.test(attribute.value.trim())
    ) {
      continue;
    }
    element.setAttribute(attribute.name, attribute.value);
  }
  for (const child of Array.from(sourceElement.childNodes)) {
    element.append(rebuildNode(document, child));
  }
  return element;
}
