import { EditorSelection } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";

import { CALLOUT_SVG_ICONS, getCalloutSvg, defaultCalloutTitle } from "../markdown/callout-data.ts";

export { CALLOUT_SVG_ICONS, getCalloutSvg, defaultCalloutTitle };

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
        const editorDoc = state.doc;
        const index = state.field(markdownRangeIndexField, false);
        const record = index?.get(this.recordId);
        if (record && record.alert) {
          const startLine = editorDoc.lineAt(record.fullRange.from);
          const safeTo =
            record.fullRange.to > record.fullRange.from &&
            editorDoc.sliceString(record.fullRange.to - 1, record.fullRange.to) === "\n"
              ? record.fullRange.to - 1
              : record.fullRange.to;
          const endLine = editorDoc.lineAt(safeTo);
          if (startLine.number < endLine.number) {
            const firstContentLine = editorDoc.line(startLine.number + 1);
            const match = /^(\s*> ?)/.exec(firstContentLine.text);
            const targetPos = firstContentLine.from + (match ? match[1].length : 0);
            view.dispatch({
              selection: EditorSelection.cursor(targetPos),
              userEvent: "select.pointer",
            });
            view.focus();
          }
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
