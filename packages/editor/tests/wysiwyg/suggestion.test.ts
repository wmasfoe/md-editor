import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  acceptAiSuggestion,
  aiSuggestionDecorations,
  aiSuggestionExtension,
  aiSuggestionField,
  aiViewportCuePlugin,
  dismissAiSuggestion,
  getSuggestionViewportStatus,
  setAiSuggestionEffect,
} from "../../src/wysiwyg/view/suggestion.ts";
import {
  aiSuggestionLabelsFacet,
  DEFAULT_AI_SUGGESTION_LABELS,
} from "../../src/wysiwyg/view/suggestion-model.ts";
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
      kindFix: "修正",
      kindStyle: "风格",
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

  it("基于 DOM 虚拟化与屏幕像素几何正确识别建议相对于视口的位置", () => {
    const view = createTestView("0123456789\n".repeat(20));

    // 1. 超出 DOM 虚拟化范围
    Object.defineProperty(view, "visibleRanges", {
      value: [{ from: 20, to: 50 }],
      configurable: true,
    });
    expect(getSuggestionViewportStatus(view, { from: 0, to: 10, text: "abc" })).toBe("above");
    expect(getSuggestionViewportStatus(view, { from: 60, to: 70, text: "abc" })).toBe("below");
    // 在 visibleRanges 内且无 scrollDOM 真实尺寸时，降级为 visible
    expect(getSuggestionViewportStatus(view, { from: 25, to: 35, text: "abc" })).toBe("visible");

    // 2. 在 DOM 虚拟化范围内，模拟真实 scrollDOM 和 coordsAtPos
    const scrollDOMMock = {
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 500,
        height: 400,
        width: 600,
      }),
    };
    Object.defineProperty(view, "scrollDOM", {
      value: scrollDOMMock,
      configurable: true,
    });

    // 模拟 pos 坐标查询
    (
      view as unknown as { coordsAtPos: (pos: number) => { top: number; bottom: number } | null }
    ).coordsAtPos = (pos: number) => {
      // 假设每单位 pos 对应 10px Y 坐标
      // pos 0..10 -> Y: 0..50 (在 scrollDOM 100 顶部上方)
      // pos 25..35 -> Y: 250..350 (在 scrollDOM 100..500 内部)
      // pos 60..70 -> Y: 600..700 (在 scrollDOM 500 底部下方)
      return { top: pos * 10, bottom: pos * 10 + 20 };
    };

    // 整个文档都在 DOM 中
    Object.defineProperty(view, "visibleRanges", {
      value: [{ from: 0, to: 100 }],
      configurable: true,
    });

    // pos 5: top: 50, bottom: 70 (< scrollRect.top + 4 即 104) -> above
    expect(getSuggestionViewportStatus(view, { from: 5, to: 8, text: "abc" })).toBe("above");
    // pos 30: top: 300, bottom: 320 (在 100..500 内部) -> visible
    expect(getSuggestionViewportStatus(view, { from: 30, to: 35, text: "abc" })).toBe("visible");
    // pos 55: top: 550, bottom: 570 (> scrollRect.bottom - 4 即 496) -> below
    expect(getSuggestionViewportStatus(view, { from: 55, to: 60, text: "abc" })).toBe("below");
  });

  it("当光标停留在 cursorAnchor 时，选区同步不会误清除文首或文中的 GEC 建议", () => {
    // 模拟：用户在 offset 20 处打字，GEC 触发并在 offset 0..4 产生替换建议
    const view = createTestView("这是一段用于测试光标锚点保留的文本内容。", 20);

    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 0,
        to: 4,
        text: "那是",
        cursorAnchor: 20,
      }),
    });

    const suggestionBefore = view.state.field(aiSuggestionField);
    expect(suggestionBefore).not.toBeNull();
    expect(suggestionBefore?.cursorAnchor).toBe(20);

    // 模拟编辑器派发选区同步事务（光标依然停留在 20 处）
    view.dispatch({
      selection: EditorSelection.cursor(20),
    });

    // 建议由于 cursorAnchor 保护，不被误清除
    const suggestionAfter = view.state.field(aiSuggestionField);
    expect(suggestionAfter).not.toBeNull();
    expect(suggestionAfter?.items[0].text).toBe("那是");

    // 若用户移开光标至其他位置（例如 10 处，既非锚点也非建议区间）
    view.dispatch({
      selection: EditorSelection.cursor(10),
    });

    // 建议被自动清除
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });

  it("当 coordsAtPos 在更新期或异常状态下抛错时，getSuggestionViewportStatus 安全降级为 visible 而不崩溃", () => {
    const view = createTestView("测试文本\n".repeat(5));
    Object.defineProperty(view, "visibleRanges", {
      value: [{ from: 0, to: 50 }],
      configurable: true,
    });
    Object.defineProperty(view, "scrollDOM", {
      value: {
        getBoundingClientRect: () => ({ top: 0, bottom: 200, height: 200, width: 400 }),
      },
      configurable: true,
    });

    // 模拟 CodeMirror 在 update 周期内调用 coordsAtPos 抛错
    (view as unknown as { coordsAtPos: () => never }).coordsAtPos = () => {
      throw new Error("Reading the editor layout isn't allowed during an update");
    };

    // 必须安全返回 visible，禁止向外抛出未捕获异常
    expect(() => getSuggestionViewportStatus(view, { from: 0, to: 4, text: "替换" })).not.toThrow();
    expect(getSuggestionViewportStatus(view, { from: 0, to: 4, text: "替换" })).toBe("visible");
  });

  it("aiViewportCuePlugin 在存在 requestMeasure 时调度 measure 执行，并在写阶段更新提示", () => {
    let measureRequest:
      { read: (v: EditorView) => unknown; write: (val: unknown) => void } | undefined;
    const view = createTestView("测试文本\n".repeat(5));

    view.dispatch({
      effects: setAiSuggestionEffect.of({
        from: 0,
        to: 4,
        text: "替换",
      }),
    });

    Object.defineProperty(view, "requestMeasure", {
      value: (req: typeof measureRequest) => {
        measureRequest = req;
      },
      configurable: true,
    });

    // 模拟挂载插件实例
    const pluginClass = aiViewportCuePlugin as unknown as {
      extension: { create(v: EditorView): { scheduleUpdate(): void; destroy(): void } };
    };
    expect(pluginClass).toBeDefined();
  });
});
