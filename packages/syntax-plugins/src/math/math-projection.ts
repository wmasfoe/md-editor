import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { MarkdownRangeRecord } from "@md-editor/renderer-codemirror";
import { getLoadedKatex, loadKatex, renderMathHtml } from "./math-loader.ts";
import { MATH_NODES, type MathMetadata } from "./math-types.ts";

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
 * 行内数学公式 Widget（Typora 风格原位渲染）。
 */
export class MathInlineWidget extends WidgetType {
  constructor(
    readonly recordId: string,
    readonly expression: string,
    readonly anchorPos: number,
  ) {
    super();
  }

  eq(other: MathInlineWidget): boolean {
    return this.recordId === other.recordId && this.expression === other.expression;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "cm-md-math-inline";
    span.setAttribute("role", "math");
    span.setAttribute("aria-label", `Math: ${this.expression}`);
    span.setAttribute("data-record-id", this.recordId);

    const { html, error } = renderMathHtml(this.expression, false);
    span.innerHTML = html;

    if (error) {
      span.classList.add("cm-md-math--has-error");
    }

    // 无论 KaTeX 是否已预加载，渲染完成后均通过 mustMeasureContent 调度 HeightMap 重测，
    // 杜绝公式挂载引起的视口垂直坐标脱节
    if (!getLoadedKatex()) {
      void loadKatex().then(() => {
        const rendered = renderMathHtml(this.expression, false);
        span.innerHTML = rendered.html;
        if (rendered.error) {
          span.classList.add("cm-md-math--has-error");
        } else {
          span.classList.remove("cm-md-math--has-error");
        }
        scheduleHeightMeasure(view, `math-inline-${this.recordId}`);
      });
    } else {
      scheduleHeightMeasure(view, `math-inline-${this.recordId}`);
    }

    // 点击原位激活编辑模式：光标移入 $ 标记之后，立即展开源码
    span.addEventListener("mousedown", (e) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: Math.min(this.anchorPos + 1, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });

    return span;
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
      scheduleHeightMeasure(view, `math-inline-destroy-${this.recordId}`);
    }
  }

  override ignoreEvent(_event: Event): boolean {
    return false;
  }
}

/**
 * 块级独立数学公式 Widget。
 */
export class MathBlockWidget extends WidgetType {
  constructor(
    readonly recordId: string,
    readonly expression: string,
    readonly anchorPos: number,
  ) {
    super();
  }

  eq(other: MathBlockWidget): boolean {
    return this.recordId === other.recordId && this.expression === other.expression;
  }

  toDOM(view: EditorView): HTMLElement {
    const div = view.dom.ownerDocument.createElement("div");
    div.className = "cm-md-math-block";
    div.setAttribute("role", "math");
    div.setAttribute("aria-label", `Display Math: ${this.expression}`);
    div.setAttribute("data-record-id", this.recordId);

    const { html, error } = renderMathHtml(this.expression, true);
    div.innerHTML = html;

    if (error) {
      div.classList.add("cm-md-math--has-error");
    }

    if (!getLoadedKatex()) {
      void loadKatex().then(() => {
        const rendered = renderMathHtml(this.expression, true);
        div.innerHTML = rendered.html;
        if (rendered.error) {
          div.classList.add("cm-md-math--has-error");
        } else {
          div.classList.remove("cm-md-math--has-error");
        }
        scheduleHeightMeasure(view, `math-block-${this.recordId}`);
      });
    } else {
      scheduleHeightMeasure(view, `math-block-${this.recordId}`);
    }

    // 点击进入块级公式编辑态：光标定位在公式正文开头
    div.addEventListener("mousedown", (e) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({
        selection: { anchor: Math.min(this.anchorPos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });

    return div;
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
      scheduleHeightMeasure(view, `math-block-destroy-${this.recordId}`);
    }
  }

  override get estimatedHeight(): number {
    return 48;
  }

  override ignoreEvent(_event: Event): boolean {
    return false;
  }
}

/**
 * 构建 LaTeX 数学公式的 WYSIWYG 布局装饰。
 */
export function buildMathLayoutDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
  context?: { active: boolean; selected: boolean },
): readonly Range<Decoration>[] {
  const meta = (record.metadata?.math ?? (record as unknown as Record<string, unknown>).math) as
    MathMetadata | undefined;

  if (!meta) {
    return [];
  }

  const active = context?.active ?? false;
  const decorations: Range<Decoration>[] = [];

  if (record.nodeName === MATH_NODES.InlineMath) {
    if (active) {
      // 激活态：展开原始 Markdown 源码供打字修改，对前后 $ 标记施加轻量微光淡化样式
      if (meta.openingMarkerRange) {
        decorations.push(
          Decoration.mark({
            class: "cm-md-marker cm-md-marker--math",
            wysiwygRecordId: record.id,
            wysiwygRole: "math-marker",
          }).range(meta.openingMarkerRange.from, meta.openingMarkerRange.to),
        );
      }
      if (meta.closingMarkerRange) {
        decorations.push(
          Decoration.mark({
            class: "cm-md-marker cm-md-marker--math",
            wysiwygRecordId: record.id,
            wysiwygRole: "math-marker",
          }).range(meta.closingMarkerRange.from, meta.closingMarkerRange.to),
        );
      }
    } else {
      // 非激活态：整体替换为渲染出的 KaTeX 行内排版
      decorations.push(
        Decoration.replace({
          widget: new MathInlineWidget(record.id, meta.expression, record.fullRange.from),
          inclusive: false,
          wysiwygRecordId: record.id,
          wysiwygRole: "math-inline-widget",
        }).range(record.fullRange.from, record.fullRange.to),
      );
    }
  } else if (record.nodeName === MATH_NODES.BlockMath) {
    if (active) {
      // 激活态：原位展开多行源码，高亮 $$ 标记
      if (meta.openingMarkerRange) {
        decorations.push(
          Decoration.mark({
            class: "cm-md-marker cm-md-marker--math-block",
            wysiwygRecordId: record.id,
            wysiwygRole: "math-block-marker",
          }).range(meta.openingMarkerRange.from, meta.openingMarkerRange.to),
        );
      }
      if (meta.closingMarkerRange) {
        decorations.push(
          Decoration.mark({
            class: "cm-md-marker cm-md-marker--math-block",
            wysiwygRecordId: record.id,
            wysiwygRole: "math-block-marker",
          }).range(meta.closingMarkerRange.from, meta.closingMarkerRange.to),
        );
      }
    } else {
      // 非激活态：整块替换为居中排版的独立数学公式
      const clickAnchor = meta.contentRange?.from ?? record.fullRange.from + 2;
      decorations.push(
        Decoration.replace({
          widget: new MathBlockWidget(record.id, meta.expression, clickAnchor),
          inclusive: false,
          block: true,
          wysiwygRecordId: record.id,
          wysiwygRole: "math-block-widget",
        }).range(record.fullRange.from, record.fullRange.to),
      );
    }
  }

  return decorations;
}
