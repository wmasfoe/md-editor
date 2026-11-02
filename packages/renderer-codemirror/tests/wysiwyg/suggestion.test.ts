import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  acceptAiSuggestion,
  aiSuggestionDecorations,
  aiSuggestionExtension,
  aiSuggestionField,
  aiSuggestionLabelsFacet,
  DEFAULT_AI_SUGGESTION_LABELS,
  dismissAiSuggestion,
  setAiSuggestionEffect,
} from "../../src/wysiwyg/view/suggestion.ts";
import { setEditorModeEffect } from "../../src/mode.ts";

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

  it("在派发 setEditorModeEffect 时自动清除幽灵文本建议", () => {
    const view = createTestView("人工智能正在", 6);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 6,
        to: 6,
        text: "改变世界。",
      }),
    });
    expect(view.state.field(aiSuggestionField)).not.toBeNull();

    view.dispatch({
      effects: setEditorModeEffect.of("source"),
    });
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });

  it("支持多行段落与带前导换行的续写内容，能够正常渲染 Decorations 并通过 Tab 接受", () => {
    const view = createTestView("人工智能正在", 6);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 6,
        to: 6,
        text: "\n\n改变世界。\n第二行深入发展。",
      }),
    });

    const decorations = view.state.field(aiSuggestionDecorations);
    expect(decorations.size).toBe(1);

    expect(acceptAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("人工智能正在\n\n改变世界。\n第二行深入发展。");
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

  it("支持多 Diff 建议队列逐项决策：Tab 接受 A -> Esc 拒绝 B -> Tab 接受 C", () => {
    // 原文："今天天气很不好，否认不是吗"
    // Diff 1 (A): [4, 7, "很不好", "晴空万里"]
    // Diff 2 (B): [8, 10, "否认", "确定"]
    // Diff 3 (C): [12, 13, "吗", "呢"]
    const view = createTestView("今天天气很不好，否认不是吗", 0);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        items: [
          { from: 4, to: 7, text: "晴空万里", originalText: "很不好" },
          { from: 8, to: 10, text: "确定", originalText: "否认" },
          { from: 12, to: 13, text: "呢", originalText: "吗" },
        ],
        activeIndex: 0,
      }),
    });

    const initial = view.state.field(aiSuggestionField);
    expect(initial?.items.length).toBe(3);
    expect(initial?.activeIndex).toBe(0);

    // 1. Tab 接受 A ("很不好" -> "晴空万里", 长度 +1)
    expect(acceptAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("今天天气晴空万里，否认不是吗");
    const afterA = view.state.field(aiSuggestionField);
    expect(afterA).not.toBeNull();
    expect(afterA?.activeIndex).toBe(1);
    // 验证后续项 B 和 C 坐标已被自动平移 +1
    expect(afterA?.items[1].from).toBe(9);
    expect(afterA?.items[1].to).toBe(11);
    expect(afterA?.items[2].from).toBe(13);
    expect(afterA?.items[2].to).toBe(14);

    // 2. Esc 拒绝 B (保持 "否认"，进入 C)
    expect(dismissAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("今天天气晴空万里，否认不是吗");
    const afterB = view.state.field(aiSuggestionField);
    expect(afterB).not.toBeNull();
    expect(afterB?.activeIndex).toBe(2);

    // 3. Tab 接受 C ("吗" -> "呢")
    expect(acceptAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("今天天气晴空万里，否认不是呢");
    // 全部项决策完毕，队列清空
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });

  it("Case I-2b: 视口严格仅渲染 activeIndex 单一焦点 (捍卫 P1 流式单焦点)", () => {
    const view = createTestView("第一处错误，第二处错误，第三处错误", 0);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        items: [
          { from: 0, to: 5, text: "一修正", originalText: "第一处错误" },
          { from: 6, to: 11, text: "二修正", originalText: "第二处错误" },
          { from: 12, to: 17, text: "三修正", originalText: "第三处错误" },
        ],
        activeIndex: 0,
      }),
    });

    // 验证当前 decorations 仅为 activeIndex (0) 的 1 个 mark + 1 个 widget，共 2 个装饰
    // 后续 2 个项绝对不生成 cm-md-ai-diff-pending 装饰
    const initialDecos = view.state.field(aiSuggestionDecorations);
    expect(initialDecos.size).toBe(2);

    // Tab 推进到第 1 项
    expect(acceptAiSuggestion(view)).toBe(true);
    const step2Decos = view.state.field(aiSuggestionDecorations);
    expect(step2Decos.size).toBe(2);
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

    // 光标移动到很远处 (pos 40)
    view.dispatch({
      selection: EditorSelection.cursor(4),
    });
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });
});

describe("AI Suggestion: i18n Labels", () => {
  it("默认采用中文标签 'Tab 接受 · Esc 取消'", () => {
    expect(DEFAULT_AI_SUGGESTION_LABELS).toEqual({
      accept: "接受",
      dismiss: "取消",
      tabKey: "Tab",
      escKey: "Esc",
    });

    const view = createTestView("hello world", 0);
    const facet = view.state.facet(aiSuggestionLabelsFacet);
    expect(facet.accept).toBe("接受");
    expect(facet.dismiss).toBe("取消");
    expect(facet.tabKey).toBe("Tab");
    expect(facet.escKey).toBe("Esc");
  });

  it("支持通过 Facet 全局注入自定义国际化标签 (如日语 'Tab 承認 · Esc 破棄')", () => {
    const state = EditorState.create({
      doc: "日本語テキスト",
      extensions: [
        aiSuggestionExtension,
        aiSuggestionLabelsFacet.of({ accept: "承認", dismiss: "破棄" }),
      ],
    });
    const facet = state.facet(aiSuggestionLabelsFacet);
    expect(facet.accept).toBe("承認");
    expect(facet.dismiss).toBe("破棄");
    expect(facet.tabKey).toBe("Tab");
    expect(facet.escKey).toBe("Esc");
  });

  it("支持通过建议输入对象 labels 覆盖单次建议的标签并保留至后续项", () => {
    const view = createTestView("hello world", 0);
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        items: [
          { from: 0, to: 5, text: "hi", originalText: "hello" },
          { from: 6, to: 11, text: "earth", originalText: "world" },
        ],
        activeIndex: 0,
        labels: {
          accept: "Accept",
          dismiss: "Discard",
        },
      }),
    });

    const initial = view.state.field(aiSuggestionField);
    expect(initial?.labels?.accept).toBe("Accept");
    expect(initial?.labels?.dismiss).toBe("Discard");

    // 接受第一项，流转到第二项
    expect(acceptAiSuggestion(view)).toBe(true);
    const after = view.state.field(aiSuggestionField);
    expect(after?.activeIndex).toBe(1);
    expect(after?.labels?.accept).toBe("Accept");
    expect(after?.labels?.dismiss).toBe("Discard");
  });

  it("视口外建议两阶段 Tab：第 1 次按 Tab 仅平滑定位不修改文档，第 2 次按 Tab 真正落入文档", () => {
    const view = createTestView(
      "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10",
    );
    // 模拟视口为前 2 行 [0, 15]
    Object.defineProperty(view, "visibleRanges", {
      value: [{ from: 0, to: 15 }],
      configurable: true,
    });

    // 建议落在视口外第 8 行 (from: 50, to: 55)
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 50,
        to: 55,
        text: "Replacement",
      }),
    });

    const docBefore = view.state.doc.toString();

    // 第 1 次 Tab：建议在视口外，仅滚动并标记 hasScrolledIntoView，文档不改变
    const step1Result = acceptAiSuggestion(view);
    expect(step1Result).toBe(true);
    expect(view.state.doc.toString()).toBe(docBefore);
    expect(view.state.field(aiSuggestionField)?.hasScrolledIntoView).toBe(true);

    // 第 2 次 Tab：再次按 Tab 真正接受并替换文档
    const step2Result = acceptAiSuggestion(view);
    expect(step2Result).toBe(true);
    expect(view.state.doc.toString()).not.toBe(docBefore);
    expect(view.state.doc.toString()).toContain("Replacement");
  });

  it("自动过滤修改前和修改后完全相同的建议项", () => {
    const view = createTestView("这是一段测试文字。");

    // 1. 设置时，originalText === text 的项被安全剔除
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 0,
        to: 4,
        originalText: "这是一段",
        text: "这是一段",
      }),
    });
    expect(view.state.field(aiSuggestionField)).toBeNull();

    // 2. 如果文档中当前文字与替换文本已经一致，accept 时不产生多余修改
    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 0,
        to: 4,
        text: "这是一段",
      }),
    });
    expect(acceptAiSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("这是一段测试文字。");
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });
});
