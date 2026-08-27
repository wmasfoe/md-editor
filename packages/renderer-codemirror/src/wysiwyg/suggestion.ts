import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";

export interface AiSuggestionValue {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly originalText?: string;
  readonly explanation?: string;
}

export const setAiSuggestionEffect = StateEffect.define<AiSuggestionValue | null>();
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
    span.textContent = this.text;

    const badge = doc.createElement("span");
    badge.className = "cm-md-ai-badge";
    badge.textContent = "Tab 接受 · Esc 取消";
    span.append(badge);

    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class DiffAdditionWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: DiffAdditionWidget): boolean {
    return other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view?.dom?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return null as never;
    }
    const span = doc.createElement("span");
    span.className = "cm-md-ai-diff-added";
    span.textContent = this.text;

    const badge = doc.createElement("span");
    badge.className = "cm-md-ai-badge";
    badge.textContent = "Tab 接受 · Esc 取消";
    span.append(badge);

    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export const aiSuggestionField = StateField.define<AiSuggestionValue | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setAiSuggestionEffect)) {
        return effect.value;
      }
      if (effect.is(clearAiSuggestionEffect)) {
        return null;
      }
    }

    if (value === null) {
      return null;
    }

    // 文档变更时如果不是本插件事务,且修改了建议区域则自动清除
    if (transaction.docChanged) {
      if (transaction.isUserEvent("input.ai")) {
        return null;
      }
      return null;
    }

    // 光标移动离开建议点时清除建议
    if (transaction.selection) {
      const head = transaction.selection.main.head;
      if (head < value.from || head > value.to) {
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
    if (!suggestion) {
      return Decoration.none;
    }

    const docLen = transaction.state.doc.length;
    const from = Math.min(Math.max(0, suggestion.from), docLen);
    const to = Math.min(Math.max(from, suggestion.to), docLen);

    if (from === to) {
      // Continuation: 纯幽灵文本在光标后
      return Decoration.set([
        Decoration.widget({
          widget: new GhostTextWidget(suggestion.text),
          side: 1,
        }).range(from),
      ]);
    }

    // Edit/Rewrite: 删除线原词 + 绿色新增候选词
    return Decoration.set([
      Decoration.mark({
        class: "cm-md-ai-diff-deleted",
        attributes: { "aria-label": "AI 建议替换的原内容" },
      }).range(from, to),
      Decoration.widget({
        widget: new DiffAdditionWidget(suggestion.text),
        side: 1,
      }).range(to),
    ]);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function acceptAiSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(aiSuggestionField);
  if (!suggestion) {
    return false;
  }

  const docLen = view.state.doc.length;
  const from = Math.min(Math.max(0, suggestion.from), docLen);
  const to = Math.min(Math.max(from, suggestion.to), docLen);

  view.dispatch({
    changes: { from, to, insert: suggestion.text },
    selection: { anchor: from + suggestion.text.length },
    effects: [clearAiSuggestionEffect.of(undefined)],
    annotations: [isolateHistory.of("full")],
    userEvent: "input.ai",
  });
  return true;
}

export function dismissAiSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(aiSuggestionField);
  if (!suggestion) {
    return false;
  }

  view.dispatch({
    effects: clearAiSuggestionEffect.of(undefined),
  });
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
    fontStyle: "italic",
    opacity: "0.78",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".cm-md-ai-badge": {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "0.45rem",
    padding: "0.08rem 0.35rem",
    borderRadius: "4px",
    background: "var(--theme-primary-soft, rgba(110, 31, 44, 0.1))",
    color: "var(--theme-primary, #6e1f2c)",
    fontSize: "0.7em",
    fontStyle: "normal",
    fontWeight: "500",
    verticalAlign: "baseline",
    userSelect: "none",
  },
  ".cm-md-ai-diff-deleted": {
    textDecoration: "line-through",
    textDecorationColor: "var(--theme-danger-text, #cf222e)",
    backgroundColor: "var(--theme-danger-bg, rgba(207, 34, 46, 0.1))",
    color: "var(--theme-muted, currentColor)",
    opacity: "0.7",
  },
  ".cm-md-ai-diff-added": {
    display: "inline-flex",
    alignItems: "baseline",
    backgroundColor: "rgba(46, 160, 67, 0.15)",
    color: "var(--theme-code-string, #2e7d32)",
    padding: "0 0.2rem",
    borderRadius: "3px",
    fontStyle: "normal",
  },
});

export const aiSuggestionExtension: Extension[] = [
  aiSuggestionField,
  aiSuggestionDecorations,
  aiSuggestionKeymap,
  aiSuggestionTheme,
];
