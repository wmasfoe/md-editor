import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  acceptAiSuggestion,
  aiSuggestionExtension,
  aiSuggestionField,
  dismissAiSuggestion,
  setAiSuggestionEffect,
} from "./suggestion.ts";

function createTestView(doc: string, cursor = 0): EditorView {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [history(), aiSuggestionExtension],
  });
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
    focus() {},
  } as unknown as EditorView;
}

describe("AI Suggestion: Ghost Text Continuation", () => {
  it("能够设置并在光标处渲染续写幽灵文本", () => {
    const view = createTestView("人工智能正在");
    expect(view.state.field(aiSuggestionField)).toBeNull();

    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 6,
        to: 6,
        text: "改变世界。",
      }),
    });

    const suggestion = view.state.field(aiSuggestionField);
    expect(suggestion).not.toBeNull();
    expect(suggestion?.text).toBe("改变世界。");
  });

  it("通过 acceptAiSuggestion 接受续写,单事务写入文档并支持 Undo", () => {
    const view = createTestView("人工智能正在", 6);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 6,
        to: 6,
        text: "改变世界。",
      }),
    });

    expect(acceptAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("人工智能正在改变世界。");
    expect(view.state.field(aiSuggestionField)).toBeNull();
    expect(view.state.selection.main.head).toBe(11);

    // 单次 Undo 恢复原状
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("人工智能正在");
  });

  it("通过 dismissAiSuggestion 驳回续写,文档不改变", () => {
    const view = createTestView("人工智能正在", 6);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 6,
        to: 6,
        text: "改变世界。",
      }),
    });

    expect(dismissAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("人工智能正在");
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });
});

describe("AI Suggestion: Rewrite / Diff Edit", () => {
  it("支持选区替换建议并在 acceptAiSuggestion 时执行精确替换", () => {
    const view = createTestView("今天天气很不好", 0);
    // 替换 "很不好" -> "晴空万里"
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 4,
        to: 7,
        text: "晴空万里",
        originalText: "很不好",
      }),
    });

    expect(view.state.field(aiSuggestionField)).not.toBeNull();
    expect(acceptAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("今天天气晴空万里");
    expect(view.state.field(aiSuggestionField)).toBeNull();

    // 单次 Undo 撤销替换
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("今天天气很不好");
  });

  it("普通输入或选区移出自动清除建议", () => {
    const view = createTestView("段落测试", 0);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 0,
        to: 0,
        text: "自动补全",
      }),
    });
    expect(view.state.field(aiSuggestionField)).not.toBeNull();

    // 光标移动到末尾 (pos 4)
    view.dispatch({
      selection: EditorSelection.cursor(4),
    });
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });
});
