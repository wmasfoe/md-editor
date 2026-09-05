import { EditorSelection } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { markdownRangeIndexField } from "../markdown/range-index.ts";

/**
 * 严格使用矢量 SVG 图标（16px），杜绝使用原生 Emoji。
 * 支持 GFM Alert (NOTE, TIP, IMPORTANT, WARNING, CAUTION) 与常见 Container Directive (info, tip, danger 等)。
 */
export const CALLOUT_SVG_ICONS: Readonly<Record<string, string>> = Object.freeze({
  info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>`,
  tip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path d="M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.044a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-.044c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.5 18a1.5 1.5 0 003 0h-3z" /></svg>`,
  note: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>`,
  important: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>`,
  warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>`,
  danger: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" /></svg>`,
  caution: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" class="cm-md-directive__svg" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" /></svg>`,
});

export function getCalloutSvg(type: string): string {
  const normalized = type.toLowerCase();
  return CALLOUT_SVG_ICONS[normalized] ?? CALLOUT_SVG_ICONS.info;
}

export function defaultCalloutTitle(type: string): string {
  switch (type.toLowerCase()) {
    case "tip":
      return "Tip";
    case "note":
      return "Note";
    case "important":
      return "Important";
    case "warning":
      return "Warning";
    case "danger":
      return "Danger";
    case "caution":
      return "Caution";
    case "info":
    default:
      return "Info";
  }
}

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
