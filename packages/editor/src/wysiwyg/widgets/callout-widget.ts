import { EditorSelection } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";

import { getCalloutSvg, defaultCalloutTitle } from "@md-editor/plugin-sdk/syntax";

/**
 * 通用 Callout/Admonition 头部 Widget。
 * 用于所见即所得模式下将首行替换为带矢量图标与标题的视觉组件。
 */
export class CalloutHeaderWidget extends WidgetType {
  constructor(
    readonly calloutType: string,
    readonly title: string,
    readonly recordId: string,
  ) {
    super();
  }

  get directiveType(): string {
    return this.calloutType;
  }

  override eq(other: CalloutHeaderWidget): boolean {
    return (
      other.calloutType === this.calloutType &&
      other.title === this.title &&
      other.recordId === this.recordId
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return {} as HTMLElement;
    }

    const root = doc.createElement("div");
    root.className = `cm-md-directive__header-content cm-md-directive--${this.calloutType.toLowerCase()}`;
    root.dataset.recordId = this.recordId;

    const iconSpan = doc.createElement("span");
    iconSpan.className = "cm-md-directive__icon-wrap";
    iconSpan.innerHTML = getCalloutSvg(this.calloutType);
    root.appendChild(iconSpan);

    const titleSpan = doc.createElement("strong");
    titleSpan.className = "cm-md-directive__title";
    titleSpan.textContent = this.title || defaultCalloutTitle(this.calloutType);
    root.appendChild(titleSpan);

    if (typeof root.addEventListener === "function") {
      root.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (!view?.state) {
          return;
        }
        const state = view.state;
        const index = state.field(markdownRangeIndexField, false);
        const record = index?.get(this.recordId);
        const headerRange = record?.directive?.headerRange ?? record?.alert?.headerLineRange;
        if (headerRange) {
          // Enter the header's source range so the plugin's inline disclosure
          // reveals the original callout syntax; resolve the range after document edits.
          view.dispatch({
            selection: EditorSelection.cursor(headerRange.to),
            userEvent: "select.pointer",
          });
          view.focus();
          return;
        }
      });
    }

    return root;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type === "mousedown";
  }
}

/**
 * 闭合标记占位 Widget（用于隐藏闭合标记）。
 */
export class CalloutFooterWidget extends WidgetType {
  override toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return {} as HTMLElement;
    }
    const root = doc.createElement("div");
    root.className = "cm-md-directive__footer-placeholder";
    return root;
  }
}

/** 兼容旧代码引用别名 */
export { CalloutHeaderWidget as DirectiveHeaderWidget };
