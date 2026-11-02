import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { setEditorModeEffect } from "../../mode.ts";
import { wysiwygProjectionField } from "../state/projection-field.ts";
import { authorizeWysiwygProtectedChange } from "../state/change-authorization.ts";

export interface AiSuggestionItem {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly originalText?: string;
  readonly explanation?: string;
}

export interface AiSuggestionLabels {
  readonly accept?: string;
  readonly dismiss?: string;
  readonly tabKey?: string;
  readonly escKey?: string;
}

export const DEFAULT_AI_SUGGESTION_LABELS: Required<AiSuggestionLabels> = Object.freeze({
  accept: "接受",
  dismiss: "取消",
  tabKey: "Tab",
  escKey: "Esc",
});

export const aiSuggestionLabelsFacet = Facet.define<
  AiSuggestionLabels | undefined,
  Required<AiSuggestionLabels>
>({
  combine: (values) =>
    values.reduce<Required<AiSuggestionLabels>>(
      (acc, val) => (val ? Object.assign(acc, val) : acc),
      { ...DEFAULT_AI_SUGGESTION_LABELS },
    ),
});

export interface AiSuggestionValue {
  readonly items: readonly AiSuggestionItem[];
  readonly activeIndex: number;
  readonly labels?: AiSuggestionLabels;
  /** 视口外建议两阶段 Tab 状态：是否已完成第 1 阶段（平滑定位居中） */
  readonly hasScrolledIntoView?: boolean;
  /** 触发建议时的光标锚点位置（例如 GEC 触发时光标在文末，建议在文首） */
  readonly cursorAnchor?: number;
  // 向后兼容便捷字段（指向当前 active 项）
  readonly from?: number;
  readonly to?: number;
  readonly text?: string;
  readonly originalText?: string;
  readonly explanation?: string;
}

export type AiSuggestionInput =
  | AiSuggestionValue
  | AiSuggestionItem
  | readonly AiSuggestionItem[]
  | (Partial<AiSuggestionValue> & AiSuggestionItem);

export function normalizeAiSuggestionValue(
  input: AiSuggestionInput | null | undefined,
): AiSuggestionValue | null {
  if (!input) return null;

  let items: readonly AiSuggestionItem[] = [];
  let activeIndex = 0;

  if (Array.isArray(input)) {
    items = input;
  } else {
    const raw = input as unknown as Record<string, unknown>;
    if ("items" in raw && Array.isArray(raw.items) && raw.items.length > 0) {
      items = raw.items as readonly AiSuggestionItem[];
      activeIndex = Math.min(
        Math.max(0, typeof raw.activeIndex === "number" ? raw.activeIndex : 0),
        items.length - 1,
      );
    } else if (
      typeof raw.from === "number" &&
      typeof raw.to === "number" &&
      typeof raw.text === "string"
    ) {
      items = [
        {
          from: raw.from,
          to: raw.to,
          text: raw.text,
          originalText: typeof raw.originalText === "string" ? raw.originalText : undefined,
          explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
        },
      ];
    }
  }

  const validItems = items.filter(
    (item) =>
      typeof item.from === "number" &&
      typeof item.to === "number" &&
      item.from <= item.to &&
      typeof item.text === "string" &&
      item.text.length > 0 &&
      (item.originalText === undefined || item.originalText !== item.text),
  );

  if (validItems.length === 0) return null;

  const clampedIndex = Math.min(Math.max(0, activeIndex), validItems.length - 1);
  const active = validItems[clampedIndex];
  const raw = Array.isArray(input) ? null : (input as unknown as Record<string, unknown>);
  const labels = raw?.labels as AiSuggestionLabels | undefined;
  const cursorAnchor = typeof raw?.cursorAnchor === "number" ? raw.cursorAnchor : undefined;
  const hasScrolledIntoView =
    typeof raw?.hasScrolledIntoView === "boolean" ? raw.hasScrolledIntoView : undefined;

  return {
    items: validItems,
    activeIndex: clampedIndex,
    labels,
    cursorAnchor,
    hasScrolledIntoView,
    from: active.from,
    to: active.to,
    text: active.text,
    originalText: active.originalText,
    explanation: active.explanation,
  };
}

export type SuggestionViewportPosition = "above" | "below" | "visible";

/**
 * 判定建议项相对于当前编辑器可见视口的物理位置。
 * 1. 若超出 CodeMirror DOM 虚拟化渲染范围，直接判定 above / below
 * 2. 在 DOM 渲染范围内，利用 scrollDOM 与字符真实 DOMRect 计算是否位于屏幕可见视口之上/之下
 */
export function getSuggestionViewportStatus(
  view: EditorView,
  item: AiSuggestionItem,
): SuggestionViewportPosition {
  const ranges = Array.isArray(view.visibleRanges) ? view.visibleRanges : [];
  if (ranges.length === 0) return "visible";
  if (item.to < ranges[0].from) return "above";
  if (item.from > ranges[ranges.length - 1].to) return "below";

  // 2. 在 DOM 渲染范围内，根据实际屏幕滚动视口 DOMRect 进行物理像素可见性判断
  const scrollDOM = view.scrollDOM;
  if (!scrollDOM || typeof scrollDOM.getBoundingClientRect !== "function") return "visible";

  const scrollRect = scrollDOM.getBoundingClientRect();
  if (scrollRect.height <= 0 || scrollRect.width <= 0) return "visible";

  const fromCoords = view.coordsAtPos(item.from);
  const toCoords = view.coordsAtPos(item.to);
  if (!fromCoords && !toCoords) return "visible";

  const itemTop = Math.min(fromCoords?.top ?? Infinity, toCoords?.top ?? Infinity);
  const itemBottom = Math.max(fromCoords?.bottom ?? -Infinity, toCoords?.bottom ?? -Infinity);

  if (itemBottom < scrollRect.top + 4) return "above";
  if (itemTop > scrollRect.bottom - 4) return "below";
  return "visible";
}

export const setAiSuggestionEffect = StateEffect.define<AiSuggestionInput | null>();
export const clearAiSuggestionEffect = StateEffect.define<void>();
export const markAiSuggestionScrolledEffect = StateEffect.define<boolean>();

const areLabelsEq = (a?: AiSuggestionLabels, b?: AiSuggestionLabels): boolean =>
  a === b ||
  (a?.accept === b?.accept &&
    a?.dismiss === b?.dismiss &&
    a?.tabKey === b?.tabKey &&
    a?.escKey === b?.escKey);

function createAiBadge(
  doc: Document,
  labels: Required<AiSuggestionLabels>,
  step = "",
): HTMLElement {
  const badge = doc.createElement("span");
  badge.className = "cm-md-ai-badge";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = `${labels.tabKey} ${labels.accept}${step} · ${labels.escKey} ${labels.dismiss}`;
  return badge;
}

class GhostTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly labels?: Required<AiSuggestionLabels>,
  ) {
    super();
  }

  eq(other: GhostTextWidget): boolean {
    return other.text === this.text && areLabelsEq(other.labels, this.labels);
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return null as never;
    const span = doc.createElement("span");
    span.className = "cm-md-ai-ghost-text";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    span.append(createAiBadge(doc, this.labels ?? DEFAULT_AI_SUGGESTION_LABELS));
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class DiffAdditionWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly options: {
      readonly isActive: boolean;
      readonly stepLabel?: string;
      readonly labels?: Required<AiSuggestionLabels>;
    } = {
      isActive: true,
    },
  ) {
    super();
  }

  eq(other: DiffAdditionWidget): boolean {
    return (
      other.text === this.text &&
      other.options.isActive === this.options.isActive &&
      other.options.stepLabel === this.options.stepLabel &&
      areLabelsEq(other.options.labels, this.options.labels)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) return null as never;
    const span = doc.createElement("span");
    span.className = this.options.isActive
      ? "cm-md-ai-diff-added"
      : "cm-md-ai-diff-added cm-md-ai-diff-pending";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    if (this.options.isActive) {
      span.append(
        createAiBadge(
          doc,
          this.options.labels ?? DEFAULT_AI_SUGGESTION_LABELS,
          this.options.stepLabel || "",
        ),
      );
    }
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export const aiSuggestionField = StateField.define<AiSuggestionValue | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setAiSuggestionEffect)) {
        return normalizeAiSuggestionValue(effect.value);
      }
      if (effect.is(clearAiSuggestionEffect)) {
        return null;
      }
      if (effect.is(setEditorModeEffect)) {
        return null;
      }
      if (effect.is(markAiSuggestionScrolledEffect)) {
        if (!value) return null;
        return {
          ...value,
          hasScrolledIntoView: effect.value,
        };
      }
    }

    if (value === null) {
      return null;
    }

    // 文档变更时：若是 AI 自身接受事务 (input.ai)，保留并由 effect 控制；若是用户直接打字，则清除建议
    if (transaction.docChanged) {
      if (transaction.isUserEvent("input.ai")) {
        return value;
      }
      return null;
    }

    // 光标移动如果离开了所有待处理建议区间且不在触发锚点处，自动清除建议
    if (
      transaction.selection &&
      !transaction.isUserEvent("input.ai") &&
      !transaction.isUserEvent("select.ai")
    ) {
      const head = transaction.selection.main.head;
      const remainingItems = value.items.slice(value.activeIndex);
      const isInsideAny = remainingItems.some((item) => {
        if (item.from === item.to) {
          return head === item.from;
        }
        return head >= item.from && head <= item.to;
      });
      const isAtAnchor = value.cursorAnchor !== undefined && head === value.cursorAnchor;
      if (!isInsideAny && !isAtAnchor) {
        return null;
      }
    }

    return value;
  },
});

export const aiSuggestionDecorations = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    const suggestion = transaction.state.field(aiSuggestionField);
    if (!suggestion || suggestion.items.length === 0) {
      return Decoration.none;
    }

    const docLen = transaction.state.doc.length;
    const activeIndex = suggestion.activeIndex;
    const currentItem = suggestion.items[activeIndex];
    if (!currentItem) {
      return Decoration.none;
    }

    const from = Math.min(Math.max(0, currentItem.from), docLen);
    const to = Math.min(Math.max(from, currentItem.to), docLen);
    const totalRemaining = suggestion.items.length - activeIndex;

    // 若修改前后内容完全一致，不渲染无意义的删除/新增标记
    if (from < to && transaction.state.doc.sliceString(from, to) === currentItem.text) {
      return Decoration.none;
    }

    const facetLabels = transaction.state.facet(aiSuggestionLabelsFacet);
    const resolvedLabels: Required<AiSuggestionLabels> = {
      ...facetLabels,
      ...suggestion.labels,
    };

    const ranges: Range<Decoration>[] = [];

    // P1 原则约束：全篇视口中严格仅渲染 activeIndex 当前一处激活焦点。
    // 队列中的后续项（index > activeIndex）仅保留在 StateField 内存中静默待命，严禁在文档中提前渲染 pending 装饰。
    if (from === to) {
      // Continuation: 纯幽灵文本在光标后
      const displayText = currentItem.text.replace(/^[\r\n]+/u, "");
      if (displayText.trim().length > 0) {
        ranges.push(
          Decoration.widget({
            widget: new GhostTextWidget(displayText, resolvedLabels),
            side: 1,
          }).range(from),
        );
      }
    } else {
      // Edit/Rewrite: 单焦点删除线原词 + 绿色新增候选词
      ranges.push(
        Decoration.mark({
          class: "cm-md-ai-diff-deleted",
          attributes: { "aria-label": "AI 建议替换的原内容" },
        }).range(from, to),
      );
      ranges.push(
        Decoration.widget({
          widget: new DiffAdditionWidget(currentItem.text, {
            isActive: true,
            stepLabel: totalRemaining > 1 ? ` (1/${totalRemaining})` : "",
            labels: resolvedLabels,
          }),
          side: 1,
        }).range(to),
      );
    }

    if (ranges.length === 0) {
      return Decoration.none;
    }

    // CodeMirror Decoration.set 要求 Range 严格按 from 升序与 startSide 排序
    ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
    return Decoration.set(ranges);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * IME / 组合输入护栏：与 `canRunCodeBlockCommand`(`code-block-commands.ts:362-365`)、
 * `viewCommand`/`canRunStructuredCommand`(`markdown-commands.ts:87-101`) 同模式。
 *
 * 背景（D-1b，共识评审 pass-1 发现的真实缺陷）：本函数此前**没有** composing 门控，
 * 而它在 keymap facet 中是**第一个** Tab 绑定（`renderer/controller.ts`（keymap 注册）早于 `:554`），
 * 因此 IME 组合期间按 Tab 会被 AI 接受抢走，违反 D2 铁律「瞬时模态态 > 结构语义」中的
 * 第 1 步「IME 组合中 → 放行原生」。
 */
function canAcceptAiSuggestion(view: EditorView): boolean {
  const projection = view.state.field(wysiwygProjectionField, false);
  return !view.composing && (!projection || projection.compositionGuardRanges.length === 0);
}

export function acceptAiSuggestion(view: EditorView): boolean {
  if (!canAcceptAiSuggestion(view)) {
    return false;
  }
  const suggestion = view.state.field(aiSuggestionField);
  if (!suggestion || suggestion.items.length === 0) {
    return false;
  }

  const activeIndex = suggestion.activeIndex;
  const currentItem = suggestion.items[activeIndex];
  if (!currentItem) {
    return false;
  }

  // 视口外两阶段 Tab 交互：
  // 检查建议是否落在当前视口之外。若在视口外且尚未定位，第 1 次 Tab 仅平滑滚动至建议居中，不修改文档文本。
  const status = getSuggestionViewportStatus(view, currentItem);
  const isOutOfViewport = status !== "visible";

  if (isOutOfViewport && !suggestion.hasScrolledIntoView) {
    view.dispatch({
      effects: [
        EditorView.scrollIntoView(currentItem.from, { y: "center" }),
        markAiSuggestionScrolledEffect.of(true),
      ],
      userEvent: "select.ai",
    });
    return true;
  }

  const docLen = view.state.doc.length;
  const from = Math.min(Math.max(0, currentItem.from), docLen);
  const to = Math.min(Math.max(from, currentItem.to), docLen);
  const insertText = currentItem.text;

  // 防御校验：若在接受时发现文档当前内容与将要插入的文本完全一致（无实质改动），直接推进至下一项或清除
  if (from < to && view.state.sliceDoc(from, to) === insertText) {
    const nextActiveIndex = activeIndex + 1;
    const hasMore = nextActiveIndex < suggestion.items.length;
    view.dispatch({
      effects: hasMore
        ? [
            setAiSuggestionEffect.of({
              items: suggestion.items,
              activeIndex: nextActiveIndex,
              labels: suggestion.labels,
              cursorAnchor: suggestion.cursorAnchor,
            }),
          ]
        : [clearAiSuggestionEffect.of(undefined)],
    });
    return true;
  }

  const delta = insertText.length - (to - from);

  // 对队列中后续尚未处理的建议项，按长度差量进行坐标平移映射
  const nextItems: AiSuggestionItem[] = suggestion.items.map((item, idx) => {
    if (idx <= activeIndex) {
      return item;
    }
    if (item.from >= to) {
      return {
        ...item,
        from: item.from + delta,
        to: item.to + delta,
      };
    }
    return item;
  });

  const nextActiveIndex = activeIndex + 1;
  const hasMore = nextActiveIndex < nextItems.length;

  const effects: StateEffect<unknown>[] = [];
  if (hasMore) {
    effects.push(
      setAiSuggestionEffect.of({
        items: nextItems,
        activeIndex: nextActiveIndex,
        labels: suggestion.labels,
        cursorAnchor: suggestion.cursorAnchor,
      }),
    );
  } else {
    effects.push(clearAiSuggestionEffect.of(undefined));
  }

  const nextCursorPos = from + insertText.length;
  const nextTargetItem = hasMore ? nextItems[nextActiveIndex] : null;

  view.dispatch({
    changes: { from, to, insert: insertText },
    selection: {
      anchor: nextTargetItem ? nextTargetItem.from : nextCursorPos,
    },
    effects,
    // 护栏扫描发现（轮1 concern-4 首跑命中）：与 H2 同类 —— AI 接受的插入若落在
    // 受保护区（表格单元格/围栏代码/原子）会被 protection 静默拒绝，建议被消费却无落字。
    // 用户显式接受 = 授权语义，补受保护注解。
    annotations: [isolateHistory.of("full"), authorizeWysiwygProtectedChange.of(true)],
    userEvent: "input.ai",
  });

  return true;
}

export function dismissAiSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(aiSuggestionField);
  if (!suggestion || suggestion.items.length === 0) {
    return false;
  }

  const activeIndex = suggestion.activeIndex;
  const nextActiveIndex = activeIndex + 1;
  const hasMore = nextActiveIndex < suggestion.items.length;

  if (hasMore) {
    const nextTargetItem = suggestion.items[nextActiveIndex];
    view.dispatch({
      selection: {
        anchor: nextTargetItem.from,
      },
      effects: [
        setAiSuggestionEffect.of({
          items: suggestion.items,
          activeIndex: nextActiveIndex,
          labels: suggestion.labels,
          cursorAnchor: suggestion.cursorAnchor,
        }),
      ],
      userEvent: "input.ai",
    });
  } else {
    view.dispatch({
      effects: [clearAiSuggestionEffect.of(undefined)],
      userEvent: "input.ai",
    });
  }

  return true;
}

export const aiSuggestionKeymap = keymap.of([
  // D-MB：Tab 已收敛到统一 Tab arbiter（tab-arbiter-command.ts，唯一 Prec.highest Tab
  // 绑定）—— 此处不再单独绑 Tab，次序由纯决策函数单一定义（H3 由构造消失）。
  {
    key: "Mod-Enter",
    run: acceptAiSuggestion,
  },
  {
    key: "Escape",
    run: dismissAiSuggestion,
  },
]);

export const aiSuggestionTheme = EditorView.baseTheme({
  ".cm-md-ai-ghost-text": {
    color: "var(--theme-muted, #8a8a8a)",
    opacity: "0.78",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "pre-wrap",
  },
  ".cm-md-ai-badge": {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "0.45rem",
    padding: "0.1rem 0.4rem",
    borderRadius: "4px",
    background: "var(--theme-primary-soft, rgba(110, 31, 44, 0.1))",
    color: "var(--theme-primary, #6e1f2c)",
    fontSize: "0.72em",
    fontStyle: "normal",
    fontWeight: "500",
    lineHeight: "1.2",
    verticalAlign: "baseline",
    userSelect: "none",
    border: "1px solid var(--theme-border, transparent)",
  },
  ".cm-md-ai-diff-deleted": {
    textDecoration: "line-through",
    textDecorationColor: "var(--theme-danger-text, #cf222e)",
    backgroundColor: "var(--theme-danger-bg, rgba(207, 34, 46, 0.1))",
    color: "var(--theme-muted, currentColor)",
    opacity: "0.75",
    borderRadius: "2px",
    padding: "0 0.15rem",
  },
  ".cm-md-ai-diff-deleted.cm-md-ai-diff-pending": {
    opacity: "0.45",
    textDecorationStyle: "dashed",
  },
  ".cm-md-ai-diff-added": {
    display: "inline-flex",
    alignItems: "baseline",
    backgroundColor: "rgba(46, 160, 67, 0.15)",
    color: "var(--theme-code-string, #2e7d32)",
    padding: "0 0.25rem",
    borderRadius: "3px",
    fontStyle: "normal",
    marginLeft: "0.2rem",
  },
  ".cm-md-ai-diff-added.cm-md-ai-diff-pending": {
    opacity: "0.55",
    backgroundColor: "rgba(46, 160, 67, 0.08)",
  },
  ".cm-md-ai-viewport-cue": {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "50",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 14px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "500",
    color: "var(--theme-title, #1c1c1e)",
    background: "var(--theme-card, rgba(255, 255, 255, 0.92))",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid var(--theme-border, rgba(0, 0, 0, 0.12))",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)",
    cursor: "pointer",
    userSelect: "none",
    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
  },
  ".cm-md-ai-viewport-cue:hover": {
    background: "var(--theme-card-hover, rgba(255, 255, 255, 0.98))",
    transform: "translateX(-50%) scale(1.02)",
  },
  ".cm-md-ai-viewport-cue-top": {
    top: "12px",
  },
  ".cm-md-ai-viewport-cue-bottom": {
    bottom: "16px",
  },
  ".cm-md-ai-viewport-cue-btn": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2px 6px",
    borderRadius: "4px",
    background: "var(--theme-primary-soft, rgba(110, 31, 44, 0.1))",
    color: "var(--theme-primary, #6e1f2c)",
    fontSize: "11px",
    fontWeight: "600",
  },
  ".cm-md-ai-viewport-cue-close": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    marginLeft: "2px",
    color: "var(--theme-muted, #8a8a8a)",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "1",
  },
  ".cm-md-ai-viewport-cue-close:hover": {
    color: "var(--theme-title, #1c1c1e)",
    background: "rgba(0, 0, 0, 0.08)",
  },
});

export const aiViewportCuePlugin = ViewPlugin.fromClass(
  class {
    private readonly dom: HTMLElement;
    private readonly textSpan: HTMLElement;
    private readonly tabBadge: HTMLElement;
    private readonly closeBtn: HTMLElement;
    private readonly onScroll: () => void;

    constructor(private readonly view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-md-ai-viewport-cue";
      this.dom.style.display = "none";

      this.textSpan = document.createElement("span");
      this.tabBadge = Object.assign(document.createElement("span"), {
        className: "cm-md-ai-viewport-cue-btn",
      });
      this.closeBtn = Object.assign(document.createElement("span"), {
        className: "cm-md-ai-viewport-cue-close",
        textContent: "×",
        title: "Esc",
      });
      this.dom.append(this.textSpan, this.tabBadge, this.closeBtn);

      this.dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.target === this.closeBtn) {
          dismissAiSuggestion(this.view);
        } else {
          acceptAiSuggestion(this.view);
        }
      });

      this.onScroll = () => {
        this.updateCue();
      };
      this.view.scrollDOM?.addEventListener?.("scroll", this.onScroll, { passive: true });
      this.view.dom?.appendChild?.(this.dom);
      this.updateCue();
    }

    update(_update: ViewUpdate) {
      this.updateCue();
    }

    destroy() {
      this.view.scrollDOM?.removeEventListener?.("scroll", this.onScroll);
      this.dom.remove();
    }

    private updateCue() {
      const suggestion = this.view.state.field(aiSuggestionField);
      if (!suggestion || suggestion.items.length === 0) {
        this.dom.style.display = "none";
        return;
      }

      const activeIndex = suggestion.activeIndex;
      const currentItem = suggestion.items[activeIndex];
      if (!currentItem) {
        this.dom.style.display = "none";
        return;
      }

      const status = getSuggestionViewportStatus(this.view, currentItem);

      const labels = suggestion.labels ?? DEFAULT_AI_SUGGESTION_LABELS;
      const tabKey = labels.tabKey ?? "Tab";

      if (status === "above") {
        this.dom.className = "cm-md-ai-viewport-cue cm-md-ai-viewport-cue-top";
        this.dom.style.display = "inline-flex";
        this.textSpan.textContent = "↑ 上方有 AI 建议";
        this.tabBadge.textContent = `${tabKey} 定位`;
      } else if (status === "below") {
        this.dom.className = "cm-md-ai-viewport-cue cm-md-ai-viewport-cue-bottom";
        this.dom.style.display = "inline-flex";
        this.textSpan.textContent = "↓ 下方有 AI 建议";
        this.tabBadge.textContent = `${tabKey} 定位`;
      } else {
        this.dom.style.display = "none";
      }
    }
  },
);

export const aiSuggestionExtension: Extension[] = [
  aiSuggestionLabelsFacet.of(DEFAULT_AI_SUGGESTION_LABELS),
  aiSuggestionField,
  aiSuggestionDecorations,
  aiViewportCuePlugin,
  Prec.highest(aiSuggestionKeymap),
  aiSuggestionTheme,
];
