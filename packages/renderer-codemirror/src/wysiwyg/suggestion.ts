import { Prec, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";

export interface AiSuggestionItem {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly originalText?: string;
  readonly explanation?: string;
}

export interface AiSuggestionValue {
  readonly items: readonly AiSuggestionItem[];
  readonly activeIndex: number;
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
  | {
      readonly from: number;
      readonly to: number;
      readonly text: string;
      readonly originalText?: string;
      readonly explanation?: string;
      readonly items?: readonly AiSuggestionItem[];
      readonly activeIndex?: number;
    };

export function normalizeAiSuggestionValue(
  input: AiSuggestionInput | null | undefined,
): AiSuggestionValue | null {
  if (!input) {
    return null;
  }

  let items: readonly AiSuggestionItem[] = [];
  let activeIndex = 0;

  if (Array.isArray(input)) {
    items = input;
  } else if ("items" in input && Array.isArray(input.items) && input.items.length > 0) {
    items = input.items;
    activeIndex = Math.min(Math.max(0, input.activeIndex ?? 0), items.length - 1);
  } else if (
    "from" in input &&
    typeof input.from === "number" &&
    "to" in input &&
    typeof input.to === "number" &&
    "text" in input &&
    typeof input.text === "string"
  ) {
    items = [
      {
        from: input.from,
        to: input.to,
        text: input.text,
        originalText: input.originalText,
        explanation: input.explanation,
      },
    ];
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

  if (validItems.length === 0) {
    return null;
  }

  const clampedIndex = Math.min(Math.max(0, activeIndex), validItems.length - 1);
  const active = validItems[clampedIndex];

  return {
    items: validItems,
    activeIndex: clampedIndex,
    from: active.from,
    to: active.to,
    text: active.text,
    originalText: active.originalText,
    explanation: active.explanation,
  };
}

export const setAiSuggestionEffect = StateEffect.define<AiSuggestionInput | null>();
export const clearAiSuggestionEffect = StateEffect.define<void>();

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return null as never;
    }
    const span = doc.createElement("span");
    span.className = "cm-md-ai-ghost-text";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;

    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class DiffAdditionWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly options: { readonly isActive: boolean; readonly stepLabel?: string } = {
      isActive: true,
    },
  ) {
    super();
  }

  eq(other: DiffAdditionWidget): boolean {
    return (
      other.text === this.text &&
      other.options.isActive === this.options.isActive &&
      other.options.stepLabel === this.options.stepLabel
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return null as never;
    }
    const span = doc.createElement("span");
    span.className = this.options.isActive
      ? "cm-md-ai-diff-added"
      : "cm-md-ai-diff-added cm-md-ai-diff-pending";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;

    if (this.options.isActive) {
      const badge = doc.createElement("span");
      badge.className = "cm-md-ai-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = `Tab 接受${this.options.stepLabel || ""} · Esc 取消`;
      span.append(badge);
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

    // 光标移动如果离开了所有待处理建议区间，自动清除建议
    if (transaction.selection && !transaction.isUserEvent("input.ai")) {
      const head = transaction.selection.main.head;
      const remainingItems = value.items.slice(value.activeIndex);
      const isInsideAny = remainingItems.some((item) => {
        if (item.from === item.to) {
          return head === item.from;
        }
        return head >= item.from && head <= item.to;
      });
      if (!isInsideAny) {
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
    const ranges: Range<Decoration>[] = [];
    const totalRemaining = suggestion.items.length - suggestion.activeIndex;

    suggestion.items.forEach((item, index) => {
      // 已经处理完毕的前置项不予渲染
      if (index < suggestion.activeIndex) {
        return;
      }

      const from = Math.min(Math.max(0, item.from), docLen);
      const to = Math.min(Math.max(from, item.to), docLen);
      const isActive = index === suggestion.activeIndex;
      const currentStep = index - suggestion.activeIndex + 1;

      if (from === to) {
        // Continuation: 纯幽灵文本在光标后
        const inlineText = item.text.split("\n")[0] || "";
        if (inlineText) {
          ranges.push(
            Decoration.widget({
              widget: new GhostTextWidget(inlineText),
              side: 1,
            }).range(from),
          );
        }
      } else {
        // Edit/Rewrite: 删除线原词 + 绿色新增候选词
        ranges.push(
          Decoration.mark({
            class: isActive
              ? "cm-md-ai-diff-deleted"
              : "cm-md-ai-diff-deleted cm-md-ai-diff-pending",
            attributes: { "aria-label": "AI 建议替换的原内容" },
          }).range(from, to),
        );
        ranges.push(
          Decoration.widget({
            widget: new DiffAdditionWidget(item.text, {
              isActive,
              stepLabel: totalRemaining > 1 ? ` (${currentStep}/${totalRemaining})` : "",
            }),
            side: 1,
          }).range(to),
        );
      }
    });

    if (ranges.length === 0) {
      return Decoration.none;
    }

    // CodeMirror Decoration.set 要求 Range 严格按 from 升序与 startSide 排序
    ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
    return Decoration.set(ranges);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function acceptAiSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(aiSuggestionField);
  if (!suggestion || suggestion.items.length === 0) {
    return false;
  }

  const activeIndex = suggestion.activeIndex;
  const currentItem = suggestion.items[activeIndex];
  if (!currentItem) {
    return false;
  }

  const docLen = view.state.doc.length;
  const from = Math.min(Math.max(0, currentItem.from), docLen);
  const to = Math.min(Math.max(from, currentItem.to), docLen);
  const insertText = currentItem.text;
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
    annotations: [isolateHistory.of("full")],
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
  {
    key: "Tab",
    run: acceptAiSuggestion,
  },
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
});

export const aiSuggestionExtension: Extension[] = [
  aiSuggestionField,
  aiSuggestionDecorations,
  Prec.highest(aiSuggestionKeymap),
  aiSuggestionTheme,
];
