import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { MarkdownRangeRecord } from "@md-editor/renderer-codemirror";
import { renderMermaidSvg } from "./mermaid-loader.ts";
import type { MermaidMetadata } from "./mermaid-types.ts";

/**
 * Mermaid 块级图表渲染 Widget（Typora 式所见即所得原位切换）。
 */
export class MermaidBlockWidget extends WidgetType {
  constructor(
    readonly recordId: string,
    readonly code: string,
    readonly anchorPos: number,
  ) {
    super();
  }

  eq(other: MermaidBlockWidget): boolean {
    return this.recordId === other.recordId && this.code === other.code;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = view.dom.ownerDocument.createElement("div");
    container.className = "cm-md-mermaid-container";
    container.setAttribute("role", "figure");
    container.setAttribute("aria-label", "Mermaid Diagram");
    container.setAttribute("data-record-id", this.recordId);

    // 默认展示骨架占位
    const skeleton = view.dom.ownerDocument.createElement("div");
    skeleton.className = "cm-md-mermaid-loading";
    skeleton.textContent = "正在渲染图表...";
    container.appendChild(skeleton);

    const isDark =
      typeof document !== "undefined" &&
      (document.documentElement.classList.contains("dark") ||
        Boolean(view.dom.closest(".dark")) ||
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);

    // 异步拉取并渲染 SVG
    void renderMermaidSvg(this.code, isDark).then(({ svg, error }) => {
      container.innerHTML = "";
      if (error) {
        container.classList.add("cm-md-mermaid--has-error");
        const errorCard = view.dom.ownerDocument.createElement("div");
        errorCard.className = "cm-md-mermaid-error";

        const title = view.dom.ownerDocument.createElement("div");
        title.className = "cm-md-mermaid-error__title";
        title.textContent = "Mermaid 图表解析错误";

        const msg = view.dom.ownerDocument.createElement("pre");
        msg.className = "cm-md-mermaid-error__message";
        msg.textContent = error;

        const hint = view.dom.ownerDocument.createElement("div");
        hint.className = "cm-md-mermaid-error__hint";
        hint.textContent = "点击卡片进入源码编辑";

        errorCard.appendChild(title);
        errorCard.appendChild(msg);
        errorCard.appendChild(hint);
        container.appendChild(errorCard);
      } else {
        container.classList.remove("cm-md-mermaid--has-error");
        container.innerHTML = svg;
      }
    });

    // 点击图表原位展开源码：将光标移动到首行 fence 之后
    container.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 锚定在第一行 fence 末尾换行后（通常是 anchorPos + 10 左右，保证进入源码正文）
      const doc = view.state.doc;
      const firstLine = doc.lineAt(Math.min(this.anchorPos, doc.length));
      const targetPos = Math.min(firstLine.to + 1, doc.length);
      view.dispatch({
        selection: { anchor: targetPos },
        scrollIntoView: true,
      });
      view.focus();
    });

    return container;
  }

  override get estimatedHeight(): number {
    return 180;
  }

  override ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown";
  }
}

/**
 * 构建 Mermaid 图表的 WYSIWYG 布局装饰。
 */
export function buildMermaidLayoutDecorations(
  record: MarkdownRangeRecord,
  _state: EditorState,
  context?: { active: boolean; selected: boolean },
): readonly Range<Decoration>[] {
  const meta = (record.metadata?.mermaid ??
    (record as unknown as Record<string, unknown>).mermaid) as MermaidMetadata | undefined;

  if (!meta) {
    return [];
  }

  const active = context?.active ?? false;
  const decorations: Range<Decoration>[] = [];

  if (active) {
    // 激活态：原位展开原始多行 Markdown 源码供直接输入编辑
    if (meta.openingMarkerRange) {
      decorations.push(
        Decoration.mark({
          class: "cm-md-marker cm-md-marker--mermaid",
          wysiwygRecordId: record.id,
          wysiwygRole: "mermaid-marker",
        }).range(meta.openingMarkerRange.from, meta.openingMarkerRange.to),
      );
    }
    if (meta.closingMarkerRange) {
      decorations.push(
        Decoration.mark({
          class: "cm-md-marker cm-md-marker--mermaid",
          wysiwygRecordId: record.id,
          wysiwygRole: "mermaid-marker",
        }).range(meta.closingMarkerRange.from, meta.closingMarkerRange.to),
      );
    }
  } else {
    // 非激活态：整块替换为渲染出的 Mermaid SVG 矢量图表
    decorations.push(
      Decoration.replace({
        widget: new MermaidBlockWidget(record.id, meta.code, record.fullRange.from),
        inclusive: false,
        wysiwygRecordId: record.id,
        wysiwygRole: "mermaid-block-widget",
      }).range(record.fullRange.from, record.fullRange.to),
    );
  }

  return decorations;
}
