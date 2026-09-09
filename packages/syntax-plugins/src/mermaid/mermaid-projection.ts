import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { MarkdownRangeRecord } from "@md-editor/renderer-codemirror";
import { renderMermaidSvg } from "./mermaid-loader.ts";
import type { MermaidMetadata } from "./mermaid-types.ts";

function scheduleHeightMeasure(view: EditorView, key: string): void {
  view.requestMeasure({
    read(v) {
      const stateObj = (v as unknown as { viewState?: { mustMeasureContent?: boolean } }).viewState;
      if (stateObj) {
        stateObj.mustMeasureContent = true;
      }
    },
    key,
  });
}

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
    container.setAttribute("role", "graphics-document");
    container.setAttribute("aria-label", "Mermaid Diagram");
    container.setAttribute("data-record-id", this.recordId);

    const isDark = view.dom.ownerDocument.documentElement.classList.contains("dark");

    // 渲染加载中骨架屏占位
    container.innerHTML = `<div class="cm-md-mermaid-loading"><div class="cm-md-mermaid-loading__spinner"></div><span>正在渲染图表...</span></div>`;

    const renderError = (errorMsg: string) => {
      container.innerHTML = "";
      container.classList.add("cm-md-mermaid--has-error");

      const errorCard = view.dom.ownerDocument.createElement("div");
      errorCard.className = "cm-md-mermaid-error";

      const title = view.dom.ownerDocument.createElement("div");
      title.className = "cm-md-mermaid-error__title";
      title.textContent = "Mermaid 图表解析错误";

      const msg = view.dom.ownerDocument.createElement("pre");
      msg.className = "cm-md-mermaid-error__message";
      msg.textContent = errorMsg;

      const hint = view.dom.ownerDocument.createElement("div");
      hint.className = "cm-md-mermaid-error__hint";
      hint.textContent = "点击卡片进入源码编辑";

      errorCard.appendChild(title);
      errorCard.appendChild(msg);
      errorCard.appendChild(hint);
      container.appendChild(errorCard);
    };

    // 异步拉取并渲染 SVG
    void renderMermaidSvg(this.code, isDark)
      .then(({ svg, error }) => {
        if (error) {
          renderError(error);
        } else {
          container.innerHTML = "";
          container.classList.remove("cm-md-mermaid--has-error");
          container.innerHTML = svg;
        }
        scheduleHeightMeasure(view, `mermaid-${this.recordId}`);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        renderError(`模块加载失败: ${errorMsg}`);
        scheduleHeightMeasure(view, `mermaid-${this.recordId}`);
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

  override destroy(dom: HTMLElement): void {
    if (!dom || typeof dom.querySelector !== "function") {
      return;
    }
    const view =
      EditorView.findFromDOM(dom) ??
      (typeof dom.closest === "function" && dom.closest(".cm-editor")
        ? EditorView.findFromDOM(dom.closest(".cm-editor") as HTMLElement)
        : null);
    if (view) {
      scheduleHeightMeasure(view, `mermaid-destroy-${this.recordId}`);
    }
  }

  override get estimatedHeight(): number {
    return 180;
  }

  override ignoreEvent(_event: Event): boolean {
    return false;
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
        block: true,
        wysiwygRecordId: record.id,
        wysiwygRole: "mermaid-block-widget",
      }).range(record.fullRange.from, record.fullRange.to),
    );
  }

  return decorations;
}
