// @vitest-environment jsdom
/**
 * @file keymap-policy.test.ts
 * @description 编辑器对 CodeMirror 默认键位的**准入与优先级**契约。
 *
 * 这里守护两类真实缺陷（都曾在真实浏览器里复现过）：
 *
 * 1. `Mod-/` 被上游 `toggleComment` 吃掉 → 用户按约定的"切换源码/所见即所得"，
 *    结果文档里多出一段 `<!-- -->`。现在 `view.toggleSource` 归 `owner: "editor"`：
 *    桥接层用 `onToggleSourceMode` 内置实现它，上游 `toggleComment` 被准入层剔除。
 * 2. `Mod-Shift-k` 被上游 `deleteLine` 吃掉 → 整行被删，而不是插入代码块
 *    （格式化表里它是 `insertCodeBlock` 的备用键）。
 *
 * 为什么不模拟键盘：CM6 的 keymap 派发按 `event.keyCode` + 大小写匹配
 * （`@codemirror/view` `runHandlers`），在 jsdom 里合成事件极不稳定；
 * 而 `state.facet(keymap)` 的**展开顺序就是派发优先级**（先命中先赢），
 * 直接断言顺序既精确又不依赖事件模拟。
 */
import { defaultKeymap } from "@codemirror/commands";
import { createBuiltInKeymaps, resolveKeymaps } from "@md-editor/core";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type StateEffect } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { provideWysiwygDiagnostics, WysiwygDiagnostics } from "../../src/diagnostics.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  chordsMatch,
  createEditorDefaultKeymapBindings,
  createEditorKeymapExtension,
  SUPPRESSED_CODEMIRROR_KEYS,
} from "../../src/renderer/controller/default-keymap-policy.ts";
import { applyEditorKeymapOverrides } from "../../src/renderer/controller/view-operations.ts";
import {
  createMarkdownFormattingBindings,
  createMarkdownFormattingKeymap,
} from "../../src/wysiwyg/editing/markdown-formatting.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";

/**
 * 生产者视角的整栈：根键位（`root-extensions.ts`）+ WYSIWYG 投影（`wysiwyg/index.ts`）。
 *
 * 顺序刻意与生产一致 —— 根扩展在前、格式化键位在后。这正是缺陷的成因：
 * `keymap` facet 按装配顺序派发，所以只有格式化键位提权（`Prec.high`）才能赢。
 */
function createProductionKeymapStack(
  projectionOptions: Parameters<typeof createWysiwygProjectionExtensions>[1] = {},
  keymapHooks: Parameters<typeof createEditorKeymapExtension>[0] = {},
): EditorState {
  return EditorState.create({
    doc: "hello",
    extensions: [
      // WYSIWYG 投影字段依赖模式与 range-index 字段（与生产装配一致）
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      provideWysiwygDiagnostics(new WysiwygDiagnostics()),
      editorModeField,
      markdownRangeIndexField,
      createEditorKeymapExtension(keymapHooks),
      createWysiwygProjectionExtensions(
        ["blocks", "headings", "inline-styles", "links"],
        projectionOptions,
      ),
    ],
  });
}

/** facet 展开后的扁平绑定表：索引越小越先派发。 */
function flattenedBindings(state: EditorState) {
  return state.facet(keymap).flat();
}

function bindingsForChord(state: EditorState, chord: string) {
  return flattenedBindings(state).filter((binding) => chordsMatch(binding.key, chord));
}

/** 在上游 defaultKeymap 里按"同一键位"查找（上游写作 `Shift-Mod-k`，归一化后同 `Mod-Shift-k`）。 */
function upstreamBinding(chord: string) {
  return defaultKeymap.find(
    (binding) =>
      chordsMatch(binding.key, chord) ||
      chordsMatch(binding.mac, chord) ||
      chordsMatch(binding.win, chord),
  );
}

/**
 * 直接驱动生产的 `applyEditorKeymapOverrides()`（即 `ports.setKeymaps()` 的实现）：
 * 假 view 只实现 `dispatch`，把一组 effects 应用到 state 上，等价于真实 dispatch。
 */
function applyKeymaps(overrides: Record<string, string | null>) {
  const formatting = new Compartment();
  const editorCompartment = new Compartment();
  const editorKeymapHooks = { editMermaid: () => false, onToggleSourceMode: () => true };
  let state = EditorState.create({
    doc: "hello",
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      provideWysiwygDiagnostics(new WysiwygDiagnostics()),
      editorModeField,
      markdownRangeIndexField,
      formatting.of(createMarkdownFormattingKeymap()),
      editorCompartment.of(createEditorKeymapExtension(editorKeymapHooks)),
    ],
  });
  const fakeView = {
    dispatch(spec: { effects: StateEffect<unknown> }) {
      state = state.update({ effects: spec.effects }).state;
    },
  };
  applyEditorKeymapOverrides(
    fakeView as unknown as Parameters<typeof applyEditorKeymapOverrides>[0],
    [formatting, editorCompartment],
    editorKeymapHooks.editMermaid,
    editorKeymapHooks.onToggleSourceMode,
    // 生产里宿主传的是"全部内建键位 + 用户覆盖"的权威表（含 view.toggleSource）
    resolveKeymaps(createBuiltInKeymaps(), overrides),
  );
  return { state };
}

describe("defaultKeymap 准入策略", () => {
  it("剔除清单非空，且每条都仍存在于上游 defaultKeymap（上游改名时逼人重新决策）", () => {
    expect(SUPPRESSED_CODEMIRROR_KEYS.length).toBeGreaterThan(0);
    for (const chord of SUPPRESSED_CODEMIRROR_KEYS) {
      expect(
        upstreamBinding(chord),
        `上游 defaultKeymap 已无 ${chord}，请重新评估归属`,
      ).toBeDefined();
    }
  });

  it("chord 等价比较忽略修饰键顺序与字母大小写（CM 的归一化事实）", () => {
    expect(chordsMatch("Shift-Mod-k", "Mod-Shift-k")).toBe(true);
    expect(chordsMatch("Mod-Shift-K", "Mod-Shift-k")).toBe(true);
    expect(chordsMatch("Mod-Shift-k", "Mod-k")).toBe(false);
    expect(chordsMatch("Mod-/", "Mod-,")).toBe(false);
    expect(chordsMatch(undefined, "Mod-k")).toBe(false);
  });

  it("主键本身是 `-` 时也能正确拆分（CM 写作 `Mod--`）", () => {
    expect(chordsMatch("Mod--", "Mod--")).toBe(true);
    expect(chordsMatch("Mod--", "Mod-Shift--")).toBe(false);
    expect(chordsMatch("Mod-Shift--", "Shift-Mod--")).toBe(true);
    // 主键是 `-` 与主键为空/缺失不能混为一谈
    expect(chordsMatch("Mod--", "Mod-")).toBe(false);
    expect(chordsMatch("Mod--", "Mod-k")).toBe(false);
  });

  it("准入后的默认键位里没有剔除项，其余条目与上游同序", () => {
    const admitted = createEditorDefaultKeymapBindings();
    for (const chord of SUPPRESSED_CODEMIRROR_KEYS) {
      expect(admitted.map((binding) => binding.key)).not.toContain(chord);
    }
    const admittedKeys = admitted.map((binding) => binding.key);
    const upstreamOrder = defaultKeymap
      .map((binding) => binding.key)
      .filter((key) => admittedKeys.includes(key));
    expect(admittedKeys).toEqual(upstreamOrder);
  });

  it("上游 toggleComment 被剔除：整栈里的 Mod-/ 只有编辑器自己的那一条", () => {
    const withoutHandler = createProductionKeymapStack();
    // 没有 onToggleSourceMode（自行组装渲染器）时，编辑器完全不占用 Mod-/
    expect(bindingsForChord(withoutHandler, "Mod-/")).toHaveLength(0);

    const withHandler = createProductionKeymapStack({}, { onToggleSourceMode: () => true });
    const bound = bindingsForChord(withHandler, "Mod-/");
    // 恰好一条：编辑器内置实现；上游 toggleComment 已被准入层剔除，不会出现第二条
    expect(bound).toHaveLength(1);
    expect(bound[0]).not.toBe(upstreamBinding("Mod-/"));
  });
});

describe("格式化键位压过 CodeMirror 默认键位", () => {
  it("Mod-Shift-k 的首个命中项来自格式化层，而不是上游 deleteLine", () => {
    const state = createProductionKeymapStack();
    const upstream = upstreamBinding("Mod-Shift-k");
    expect(upstream, "上游 Mod-Shift-k 绑定应存在，否则本契约需要重写").toBeDefined();

    const candidates = bindingsForChord(state, "Mod-Shift-k");
    // 两层各绑一次：格式化层（合法拥有）+ 上游 deleteLine（待压过）
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).not.toBe(upstream);
    expect(candidates[1]).toBe(upstream);
  });

  it("Mod-i 的首个命中项来自格式化层，而不是上游 selectParentSyntax", () => {
    const state = createProductionKeymapStack();
    const upstream = upstreamBinding("Mod-i");
    expect(upstream).toBeDefined();

    const candidates = bindingsForChord(state, "Mod-i");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).not.toBe(upstream);
    expect(candidates[1]).toBe(upstream);
  });

  it("Mod-l / Mod-Shift-l 插入链接，且 Mod-Shift-l 不再落到搜索的 selectSelectionMatches", () => {
    const state = createProductionKeymapStack();
    // searchKeymap 与本层同为默认优先级，但追加在根扩展里；提权后格式化层胜出。
    const searchBinding = searchKeymap.find((binding) => chordsMatch(binding.key, "Mod-Shift-l"));
    expect(searchBinding, "上游 Mod-Shift-l 应来自 searchKeymap").toBeDefined();

    const candidates = bindingsForChord(state, "Mod-Shift-l");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).not.toBe(searchBinding);
    expect(candidates[1]).toBe(searchBinding);
  });

  it("运行期 reconfigure 自定义键位后仍保持提权（否则用户改一次键就回退成删行）", () => {
    const compartment = new Compartment();
    const state = createProductionKeymapStack({ formattingKeymapCompartment: compartment });
    const upstream = upstreamBinding("Mod-Shift-k");

    // 基线：默认键位的备用键已排在上游 deleteLine 之前
    expect(bindingsForChord(state, "Mod-Shift-k")[0]).not.toBe(upstream);

    // 真正走一次生产用的重配路径（`setKeymaps` → compartment.reconfigure）
    const next = state.update({
      effects: compartment.reconfigure(
        createMarkdownFormattingKeymap(new Map([["format.codeBlock", "Mod-Shift-j"]])),
      ),
    }).state;

    // 自定义主键生效，且它是唯一命中项（上游没有这个 chord）
    expect(bindingsForChord(next, "Mod-Shift-j")).toHaveLength(1);

    // 关键断言：重配后备用键 Mod-Shift-k 的第一个命中项仍在格式化层，
    // 若 reconfigure 丢了 Prec.high，这里就会变回上游 deleteLine。
    const afterReconfigure = bindingsForChord(next, "Mod-Shift-k");
    expect(afterReconfigure).toHaveLength(2);
    expect(afterReconfigure[0]).not.toBe(upstream);
    expect(afterReconfigure[1]).toBe(upstream);
  });

  it("setKeymaps 解绑 view.toggleSource 后 ⌘/ 不再有绑定（覆盖表是权威表）", () => {
    const { state } = applyKeymaps({ "view.toggleSource": null });
    expect(bindingsForChord(state, "Mod-/")).toHaveLength(0);
  });

  it("setKeymaps 改键到其它 chord 后，旧 chord 不再触发、新 chord 生效", () => {
    const { state } = applyKeymaps({ "view.toggleSource": "Mod-Shift-p" });
    expect(bindingsForChord(state, "Mod-/")).toHaveLength(0);
    expect(bindingsForChord(state, "Mod-Shift-p")).toHaveLength(1);
  });

  it("格式化表不得占用 Tab / Escape / Mod-Enter 这类结构性键位", () => {
    // 这些键位由 tab 仲裁（Prec.highest）与 HTML 源码块键位（Prec.highest）拥有；
    // 格式化层整体提权之后，一旦有人往表里加这些键，就会和那两处抢语义。
    const reserved = ["Tab", "Shift-Tab", "Escape", "Mod-Enter"];
    const formattingKeys = createMarkdownFormattingBindings()
      .map((binding) => binding.key)
      .filter((key): key is string => typeof key === "string");
    expect(formattingKeys.filter((key) => reserved.includes(key))).toEqual([]);
  });
});
