import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField, mdxModeFacet } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import {
  acceptAiSuggestion,
  aiSuggestionExtension,
  aiSuggestionField,
  setAiSuggestionEffect,
} from "../../src/wysiwyg/suggestion.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";
import { escapeBracket, isTabEscapeClosedKind } from "../../src/wysiwyg/bracket-escape-command.ts";
import { runTabArbiter } from "../../src/wysiwyg/tab-arbiter-command.ts";

/**
 * S1 / D-1 阶段 A：AI-Tab 仲裁机制的【复现优先】用例（P5 先锁行为再改）。
 *
 * 目的：在任何编码之前，用真实扩展集证实 pass-1/pass-2 共识评审的判断：
 *   - I2a 代码块体、I2b 列表项内：`acceptAiSuggestion` 的 Tab 绑定本就最先解析 → 期望 🟢 绿（回归锁）
 *   - I2c 表格单元格内：DOM keydown 拦截，keymap 够不着 → 期望 🔴 红（真实缺陷）
 *   - I2d IME 组合期：`acceptAiSuggestion` 缺 composing 门控 → 期望 🔴 红（D-1b 真实缺陷）
 *
 * 铁律：本文件在「未修复代码」上必须呈现上表的红绿分布。若红绿与预期不符，
 * 说明共识评审的机制判断有误，必须回退到 ralplan 重新定案，不得直接编码。
 */

const PROJECTION_KINDS = [
  "inline-styles",
  "headings",
  "blocks",
  "links",
  "images",
  "tables",
  "code-blocks",
] as unknown as Parameters<typeof createWysiwygProjectionExtensions>[0];

/** 共用扩展（供单光标与多光标 state 复用，保证同一仲裁面） */
function commonExtensions(extra: Extension[] = []): Extension[] {
  return [
    // 生产端 renderer.ts 同款：不开此 facet，CM6 会在 state 创建时把多光标折叠成主光标
    // （EditorState.create 的 normalizeSelection 行为）——H5 多光标断言的硬前置
    EditorState.allowMultipleSelections.of(true),
    markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
    editorModeField,
    markdownRangeIndexField,
    wysiwygChangeProtection,
    aiSuggestionExtension,
    createWysiwygProjectionExtensions(PROJECTION_KINDS),
    ...extra,
  ];
}

/** 组合真实扩展集：基座字段 + renderer.ts:553-554 的注册顺序 */
function buildState(doc: string, cursor: number, extra: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: commonExtensions(extra),
  });
}

/**
 * 从 keymap facet 取出展平后的绑定。
 * 实测：`state.facet(keymap)` 返回的是每个 `keymap.of(...)` 的**未展平数组**
 * （元素 `.key` 为 undefined），必须 `.flat()` 才能拿到 `KeyBinding`。
 */
function readBindings(state: EditorState): readonly KeyBinding[] {
  return (state.facet(keymap) as unknown as readonly (readonly KeyBinding[])[]).flat();
}

/**
 * I9 —— 仲裁顺序回归（组合式断言，严禁源码顺序 grep）。
 * 经 keymap facet 解析出的绑定顺序，钉死同 `Prec.highest` 下的注册顺序不变量。
 */
describe("I9 仲裁顺序回归：统一 Tab arbiter 单点派发（D-MB）", () => {
  it("🔴 facet 内恰好只有**一个** Tab 绑定且就是统一 arbiter —— H3 由构造消失", () => {
    const state = buildState("正文", 2);
    const tabIndex = readBindings(state)
      .map((binding, index) => ({ binding, index }))
      .filter(({ binding }) => binding.key === "Tab");
    expect(
      tabIndex.length,
      "AI/代码块/跳出/结构化四处 Tab 绑定已全部收敛到 arbiter —— 注册数组位置不再可能被误当派发顺序",
    ).toBe(1);
    expect(tabIndex[0]?.binding.run, "唯一 Tab 绑定必须是 runTabArbiter").toBe(runTabArbiter);
  });

  it("🔴 真实派发路径的 D2 全序（逐级升档：接受 → 代码块 → 跳出 → 结构）", () => {
    // 第 1 步 accept：建议激活时被消费（不落到后续执行器）
    const v1 = createTestView(buildState("正文", 2));
    suggestAt(v1, 2);
    expect(dispatchTabLikeKeymap(v1), "accept 消费 Tab").toBe(true);
    expect(v1.state.field(aiSuggestionField), "建议被接受后清空").toBeNull();

    // 第 2 步 code-block：代码块内无建议 → 缩进生效（而非跳出/结构）
    const codeDoc = "```\nfoo(bar)\n```";
    const codeCursor = codeDoc.indexOf("foo(b") + 5; // foo(b|ar)
    const v2 = createTestView(buildState(codeDoc, codeCursor));
    const before2 = v2.state.doc.toString();
    expect(dispatchTabLikeKeymap(v2), "codeBlockTab 消费 Tab").toBe(true);
    expect(v2.state.doc.toString(), "代码块 Tab = 插入缩进（文本变更）").not.toBe(before2);

    // 第 3 步 escape-bracket（AC-MB2 / H3 回归）：列表正文含括号 → **跳出而非降级层级**
    const { text: listText, offset: listOffset } = fixtureAt("- 说明（|）尾");
    const v3 = createTestView(buildState(listText, listOffset));
    expect(dispatchTabLikeKeymap(v3), "escape 消费 Tab").toBe(true);
    expect(v3.state.doc.toString(), "🔴 文本零变更（列表层级不得被缩进）").toBe(listText);
    expect(v3.state.selection.main.head, "光标跳出到全角右括号之后").toBe(
      listText.indexOf("）") + 1,
    );

    // 第 4 步 structured：列表正文无括号 → 跳出放行 → 结构尾动作兜底（缩进列表）
    const { text: plainText, offset: plainOffset } = fixtureAt("- 说明|尾");
    const v4 = createTestView(buildState(plainText, plainOffset));
    const before4 = v4.state.doc.toString();
    expect(dispatchTabLikeKeymap(v4), "structured 消费 Tab").toBe(true);
    expect(v4.state.doc.toString(), "结构尾动作缩进列表（文本变更）").not.toBe(before4);
  });
});

/** 轻量 state-backed view（沿用 suggestion.test.ts 的既有范式） */
function createTestView(state: EditorState) {
  let current = state;
  return {
    get state() {
      return current;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      current = ("state" in spec && spec.state ? spec : current.update(spec as never)).state;
    },
    focus() {},
  } as unknown as EditorView;
}

/** 按 keymap facet 的解析顺序派发 Tab，模拟 CM6 的自门控责任链 */
function dispatchTabLikeKeymap(view: EditorView): boolean {
  for (const binding of readBindings(view.state)) {
    if (binding.key !== "Tab" || typeof binding.run !== "function") continue;
    if (binding.run(view) === true) return true;
  }
  return false;
}

function suggestAt(view: EditorView, at: number) {
  view.dispatch({
    effects: setAiSuggestionEffect.of({ from: at, to: at, text: "续写。" }),
  });
}

/** 用 `|` 标记光标位置的 fixture 解析器（与 bracket-escape.test.ts 同约定） */
function fixtureAt(text: string): { text: string; offset: number } {
  const offset = text.indexOf("|");
  if (offset === -1) {
    throw new Error("fixture 缺少光标标记 |");
  }
  return { text: text.slice(0, offset) + text.slice(offset + 1), offset };
}

describe("T3–T8 CM6 适配器：括号/link 跳出（只动 selection，零文本变更）", () => {
  function escapeAt(fixture: string): { moved: boolean; text: string; cursor: number } {
    const { text: plain, offset } = fixtureAt(fixture);
    const view = createTestView(buildState(plain, offset));
    const moved = escapeBracket(view);
    return { moved, text: view.state.doc.toString(), cursor: view.state.selection.main.head };
  }

  it("T3 foo(|) → 光标移到 ) 之后", () => {
    const r = escapeAt("foo(|)");
    expect(r.moved).toBe(true);
    expect(r.text, "零文本变更").toBe("foo()");
    expect(r.cursor).toBe(5);
  });

  it("T4 foo|() → 光标跳过整对", () => {
    const r = escapeAt("foo|()");
    expect(r.moved).toBe(true);
    expect(r.text).toBe("foo()");
    expect(r.cursor).toBe(5);
  });

  it("T5 foo()| → 不动点：escapeBracket 返回 false，交还责任链（不断言『无动作』）", () => {
    const r = escapeAt("foo()|");
    expect(r.moved).toBe(false);
    expect(r.text).toBe("foo()");
    // I7：关键是 Tab **落到仲裁链下一步**，而非被本层吞掉
    expect(dispatchTabLikeKeymap(createTestView(buildState("foo()", 5)))).toBe(false);
  });

  it("T6 foo(xxx|xxx) → 非空对也跳，内容逐字符不变", () => {
    const r = escapeAt("foo(xxx|xxx)");
    expect(r.moved).toBe(true);
    expect(r.text, "T20 零文本变更").toBe("foo(xxxxxx)");
    expect(r.cursor).toBe(11);
  });

  it("T7 嵌套取最内层", () => {
    const r = escapeAt("foo(bar(baz|)qux)");
    expect(r.moved).toBe(true);
    expect(r.cursor).toBe(12);
  });

  it("T8 不平衡 → fail closed 不跳", () => {
    const r = escapeAt("foo(bar(baz|");
    expect(r.moved).toBe(false);
  });

  it("T9 链接当整体跳到右边界", () => {
    const r = escapeAt("见 [文本|](./x.md) 结束");
    expect(r.moved).toBe(true);
    expect(r.cursor).toBe("见 [文本](./x.md)".length);
  });
});

describe("(c) 位置分流：行首归结构操作，正文中间归括号跳出", () => {
  it("行首 → escapeBracket 放行（return false），列表层级优先", () => {
    const lineStart = fixtureAt("|(x)");
    expect(
      escapeBracket(createTestView(buildState(lineStart.text, lineStart.offset))),
      "行首必须放行给结构 handler",
    ).toBe(false);
  });

  it("I8/T13 列表正文中间在括号内 → 跳出且不调整列表层级（文本零变更）", () => {
    const { text, offset } = fixtureAt("- 说明（|）尾");
    const view = createTestView(buildState(text, offset));
    expect(escapeBracket(view)).toBe(true);
    expect(view.state.doc.toString(), "列表层级不得被调整（文本零变更）").toBe(text);
  });

  it("正文中间无括号 → 返回 false，兜底到列表层级（D2 第 7 步）", () => {
    const { text, offset } = fixtureAt("- 说明|尾");
    expect(escapeBracket(createTestView(buildState(text, offset)))).toBe(false);
  });
});

describe("IME 护栏（D-1b 同源）", () => {
  it("composing 期间 → 放行原生", () => {
    const { text, offset } = fixtureAt("foo(|)");
    const view = createTestView(buildState(text, offset));
    (view as unknown as { composing?: boolean }).composing = true;
    expect(escapeBracket(view)).toBe(false);
  });
});

describe("I2 三上下文：AI 建议激活时 Tab 是否被接受（复现优先）", () => {
  it("I2a 代码块体内 → 🟢 接受建议（回归锁，预期绿）", () => {
    const doc = "```\nconst x = 1\n```";
    const cursor = doc.indexOf("1") + 1;
    const view = createTestView(buildState(doc, cursor));
    suggestAt(view, cursor);
    expect(view.state.field(aiSuggestionField)).not.toBeNull();
    expect(dispatchTabLikeKeymap(view)).toBe(true);
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });

  it("I2b 列表项内 → 🟢 接受建议（回归锁，预期绿）", () => {
    const doc = "- 第一项\n- 第二项";
    const cursor = doc.length;
    const view = createTestView(buildState(doc, cursor));
    suggestAt(view, cursor);
    expect(dispatchTabLikeKeymap(view)).toBe(true);
    expect(view.state.field(aiSuggestionField)).toBeNull();
  });

  it("I2c 表格单元格层：keymap 层无缺陷（缺陷定位）", () => {
    // 缺陷点不在 keymap：`table-widget.ts` 的 DOM `keydown` 直接
    // `preventDefault()+stopPropagation()`，任何 keymap 绑定都够不着。
    // D-MB 后 keymap 层只剩统一 arbiter 一个 Tab 绑定（表格腿由 DOM 薄派发器
    // 调同一 `decideTabActions`，语义单一）。
    // 行为级验证由 desktop E2E `codemirror-d1-tab-bracket-escape.spec.ts` 的 E10/T20-cell 覆盖。
    const doc = "| a | b |\n| - | - |\n| c | d |";
    const state = buildState(doc, 3);
    const tabBindings = readBindings(state).filter((binding) => binding.key === "Tab");
    expect(tabBindings.length, "keymap 层仅有统一 arbiter 一个 Tab 绑定").toBe(1);
    expect(tabBindings[0]?.run, "且就是统一 Tab arbiter").toBe(runTabArbiter);
  });

  it("I2d IME 组合期 → 🟢 不接受建议（D-1b 修复后转绿）", () => {
    const view = createTestView(buildState("正文", 2));
    suggestAt(view, 2);

    // D-1b：`acceptAiSuggestion` 现已具备 `view.composing` / `compositionGuardRanges`
    // 门控，与 `code-block-commands.ts:362-365` 等兄弟 handler 同模式。
    // 阶段 A 曾实证缺陷（IME 组合期仍返回 true）；修复后本用例转为正向断言。
    const composingView = Object.assign(Object.create(Object.getPrototypeOf(view)), view, {
      composing: true,
    }) as unknown as EditorView;
    Object.defineProperty(composingView, "state", { get: () => view.state });

    expect(
      acceptAiSuggestion(composingView),
      "IME 组合期必须放行原生输入，不得被 AI 接受抢走 Tab（D2 铁律第 1 步）",
    ).toBe(false);
    // 建议本身不应被消耗
    expect(view.state.field(aiSuggestionField)).not.toBeNull();
  });
});

/** H4 前置断言：夹具必须真的产出目标 kind 的 record（否则失败信息直接指名缺哪类） */
function coveringRecord(
  state: EditorState,
  kind: string,
  cursor: number,
): { from: number; to: number } | null {
  const index = state.field(markdownRangeIndexField);
  const record = index.records.find(
    (r) => r.kind === kind && r.fullRange.from <= cursor && cursor <= r.fullRange.to,
  );
  return record ? { from: record.fullRange.from, to: record.fullRange.to } : null;
}

describe("AC-MB3 / H4 边界切片：五类边界内 Tab 不跳出（适配器查 range-index fail closed）", () => {
  function assertClosed(doc: string, cursor: number, kind: string, extra: Extension[] = []): void {
    const state = buildState(doc, cursor, extra);
    expect(
      coveringRecord(state, kind, cursor),
      `前置失败：夹具未产出 ${kind} record（先修夹具再谈跳出）`,
    ).not.toBeNull();
    expect(escapeBracket(createTestView(state)), `${kind} 内必须 fail closed 不跳出`).toBe(false);
    const view = createTestView(buildState(doc, cursor, extra));
    const before = view.state.doc.toString();
    expect(dispatchTabLikeKeymap(view), `${kind} 内 Tab 不被跳出消费`).toBe(false);
    expect(view.state.doc.toString(), `${kind} 文本零变更`).toBe(before);
    expect(view.state.selection.main.head, `${kind} 光标不移动`).toBe(cursor);
  }

  it("U7a frontmatter 源码内括号不跳出", () => {
    const doc = "---\nkey: foo(x)\n---\n\n正文";
    expect(() => assertClosed(doc, doc.indexOf("foo(x") + 5, "frontmatter")).not.toThrow();
  });

  it("U7b HTML 源码内括号不跳出", () => {
    const doc = "<div>\nfoo(x)\n</div>";
    expect(() => assertClosed(doc, doc.indexOf("foo(x") + 5, "html")).not.toThrow();
  });

  it("U7c MDX 源码内括号不跳出", () => {
    const doc = "<Box>\nfoo(x)\n</Box>";
    expect(() =>
      assertClosed(doc, doc.indexOf("foo(x") + 5, "mdx-jsx", [mdxModeFacet.of(true)]),
    ).not.toThrow();
  });

  it("U8a URL 段（autolink）内括号不跳出", () => {
    const doc = "见 <https://e.com/a(x)>";
    expect(() => assertClosed(doc, doc.indexOf("(x)") + 2, "autolink")).not.toThrow();
  });

  it("U8b 围栏代码体内括号不跳出（Tab 归 codeBlockTab，其消费已由 I9 升档第 2 步断言）", () => {
    const doc = "```\nfoo(x)\n```";
    const cursor = doc.indexOf("foo(x") + 5;
    const state = buildState(doc, cursor);
    expect(
      coveringRecord(state, "deferred-code", cursor),
      "前置：产出 deferred-code record",
    ).not.toBeNull();
    expect(escapeBracket(createTestView(state)), "代码体必须 fail closed 不跳出").toBe(false);
  });

  it("U10 数学段 kind 在边界集内（段级切片；math 解析器在 @md-editor/syntax-plugins，由桌面注册，故为集合级断言）", () => {
    for (const kind of ["inline-math", "block-math"] as const) {
      expect(isTabEscapeClosedKind(kind), `${kind} 必须 fail closed`).toBe(true);
    }
    // 同时钉死 AC-MB3 列举的五类 + 代码体等全部边界
    for (const kind of ["frontmatter", "html", "mdx-jsx", "autolink", "deferred-code"] as const) {
      expect(isTabEscapeClosedKind(kind), `${kind} 必须 fail closed`).toBe(true);
    }
  });
});

describe("AC-MB4 / H5 多光标：各自跳出，其余光标不丢（changeByRange）", () => {
  function multiState(doc: string, cursors: readonly number[], mainIndex = 0): EditorState {
    return EditorState.create({
      doc,
      selection: EditorSelection.create(
        cursors.map((pos) => EditorSelection.cursor(pos)),
        mainIndex,
      ),
      extensions: commonExtensions(),
    });
  }

  it("两个折叠光标都在括号内 → 各自跳出，range 数不变，文本零变更", () => {
    const doc = "foo() and bar()"; // 光标 4 与 14，各自目标 5 与 15
    const view = createTestView(multiState(doc, [4, 14]));
    expect(escapeBracket(view), "多光标跳出被消费").toBe(true);
    expect(view.state.selection.ranges.length, "🔴 光标数不得丢").toBe(2);
    expect(
      view.state.selection.ranges.map((range) => range.head),
      "各自跳出到右括号之后",
    ).toEqual([5, 15]);
    expect(view.state.doc.toString(), "零文本变更").toBe(doc);
  });

  it("部分光标无目标 → 有目标者跳出，无目标者**原地不动**（不丢）", () => {
    const doc = "foo() plain"; // 光标 4（可跳出）与 10（无括号）
    const view = createTestView(multiState(doc, [4, 10]));
    expect(escapeBracket(view)).toBe(true);
    expect(view.state.selection.ranges.length).toBe(2);
    expect(view.state.selection.ranges.map((range) => range.head)).toEqual([5, 10]);
  });

  it("全部光标无目标 → 返回 false 交还责任链（且不 dispatch）", () => {
    const doc = "foo plain";
    const view = createTestView(multiState(doc, [4]));
    expect(escapeBracket(view)).toBe(false);
    expect(view.state.selection.main.head).toBe(4);
  });

  it("含非折叠选区 → 放行责任链（保守门控，与原单光标语义一致）", () => {
    const doc = "foo(x)";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(0, 6),
      extensions: commonExtensions(),
    });
    expect(escapeBracket(createTestView(state))).toBe(false);
  });
});
