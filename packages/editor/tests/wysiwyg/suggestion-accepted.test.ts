// @vitest-environment jsdom
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { history } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  acceptAiSuggestion,
  aiSuggestionExtension,
  dismissAiSuggestion,
  setAiSuggestionEffect,
} from "../../src/wysiwyg/view/suggestion.ts";
import {
  DEFAULT_AI_SUGGESTION_LABELS,
  aiSuggestionAcceptedAnnotation,
  type AiSuggestionAcceptedEvent,
} from "../../src/wysiwyg/view/suggestion-model.ts";
import { createAiBadge } from "../../src/wysiwyg/view/suggestion-widgets.ts";

/** 记录每个事务的采纳注解的最小 EditorView 替身 */
function createRecordingView(doc: string, cursor: number) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [history(), aiSuggestionExtension],
  });
  const accepted: AiSuggestionAcceptedEvent[] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      const transaction: Transaction = state.update(spec as never);
      const event = transaction.annotation(aiSuggestionAcceptedAnnotation);
      if (event) accepted.push(event);
      state = transaction.state;
    },
    focus() {},
  } as unknown as EditorView;
  return { view, accepted };
}

describe("AI suggestion accepted event", () => {
  it("U-RC-1: accepting annotates the transaction with inserted and replaced text and kind", () => {
    const { view, accepted } = createRecordingView("我门今天去公园", 7);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        items: [
          { from: 0, to: 2, text: "我们", originalText: "我门", kind: "fix" },
          { from: 7, to: 7, text: "散步。" },
        ],
        activeIndex: 0,
      }),
    });

    expect(acceptAiSuggestion(view)).toBe(true);
    expect(accepted).toEqual([{ from: 0, to: 2, text: "我们", originalText: "我门", kind: "fix" }]);
    expect(acceptAiSuggestion(view)).toBe(true);
    expect(accepted[1]).toEqual({
      from: 7,
      to: 7,
      text: "散步。",
      originalText: "",
      kind: undefined,
    });
    expect(view.state.doc.toString()).toBe("我们今天去公园散步。");
  });

  it("U-RC-1: dismissing never emits an accepted event", () => {
    const { view, accepted } = createRecordingView("人工智能正在", 6);
    view.dispatch({ effects: setAiSuggestionEffect.of({ from: 6, to: 6, text: "改变世界。" }) });
    expect(dismissAiSuggestion(view)).toBe(true);
    expect(accepted).toEqual([]);
  });

  it("U-RC-2: badges label fix and style suggestions; plain suggestions are unchanged", () => {
    const labels = DEFAULT_AI_SUGGESTION_LABELS;
    const plain = createAiBadge(document, labels);
    const fix = createAiBadge(document, labels, "", "fix");
    const style = createAiBadge(document, labels, " (1/2)", "style");

    expect(plain.textContent).toBe("Tab 接受 · Esc 取消");
    expect(plain.dataset.kind).toBeUndefined();
    expect(fix.textContent).toBe("修正 · Tab 接受 · Esc 取消");
    expect(fix.dataset.kind).toBe("fix");
    expect(style.textContent).toBe("风格 · Tab 接受 (1/2) · Esc 取消");
    expect(style.dataset.kind).toBe("style");
  });
});
