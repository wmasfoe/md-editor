// @vitest-environment jsdom
/**
 * @file keymap-policy.test.ts
 * @description 编辑器对 CodeMirror 默认键位的**准入与优先级**契约。
 *
 * 这里守护两类真实缺陷（都曾在真实浏览器里复现过）：
 *
 * 1. `Mod-/` 被上游 `toggleComment` 吃掉 → 用户按宿主约定的"切换源码/所见即所得"，
 *    结果文档里多出一段 `<!-- -->`。归属见 `core/src/index.ts` 的 `view.toggleSource`。
 * 2. `Mod-Shift-k` 被上游 `deleteLine` 吃掉 → 整行被删，而不是插入代码块
 *    （格式化表里它是 `insertCodeBlock` 的备用键）。
 *
 * 为什么不模拟键盘：CM6 的 keymap 派发按 `event.keyCode` + 大小写匹配
 * （`@codemirror/view` `runHandlers`），在 jsdom 里合成事件极不稳定；
 * 而 `state.facet(keymap)` 的**展开顺序就是派发优先级**（先命中先赢），
 * 直接断言顺序既精确又不依赖事件模拟。
 */
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
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
import { createMarkdownFormattingBindings } from "../../src/wysiwyg/editing/markdown-formatting.ts";
import { createWysiwygProjectionExtensions } from "../../src/wysiwyg/index.ts";

/**
 * 生产者视角的整栈：根键位（`root-extensions.ts`）+ WYSIWYG 投影（`wysiwyg/index.ts`）。
 *
 * 顺序刻意与生产一致 —— 根扩展在前、格式化键位在后。这正是缺陷的成因：
 * `keymap` facet 按装配顺序派发，所以只有格式化键位提权（`Prec.high`）才能赢。
 */
function createProductionKeymapStack(extra: readonly Extension[] = []): EditorState {
  return EditorState.create({
    doc: "hello",
    extensions: [
      // WYSIWYG 投影字段依赖模式与 range-index 字段（与生产装配一致）
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      provideWysiwygDiagnostics(new WysiwygDiagnostics()),
      editorModeField,
      markdownRangeIndexField,
      createEditorKeymapExtension(),
      createWysiwygProjectionExtensions(["blocks", "headings", "inline-styles", "links"]),
      ...extra,
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

  it("生产整栈里不存在 Mod-/：宿主拿得回这个 chord", () => {
    const state = createProductionKeymapStack();
    const chords = flattenedBindings(state).flatMap((binding) =>
      [binding.key, binding.mac, binding.win].filter(
        (chord): chord is string => typeof chord === "string",
      ),
    );
    for (const chord of SUPPRESSED_CODEMIRROR_KEYS) {
      expect(chords, `${chord} 不该被编辑器绑走`).not.toContain(chord);
    }
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

  it("运行期替换自定义键位后仍保持提权（否则用户改一次键就回退成删行）", () => {
    const overwritten = new Map([["format.codeBlock", "Mod-Shift-j"]]);
    const state = createProductionKeymapStack([
      createWysiwygProjectionExtensions(["blocks"], { customFormattingKeymaps: overwritten }),
    ]);
    const upstream = upstreamBinding("Mod-Shift-k");
    const original = bindingsForChord(state, "Mod-Shift-k");
    // 主键已被改到 Mod-Shift-j；备用键 Mod-Shift-k 仍在格式化表里，且必须排在上游之前。
    expect(original[0]).not.toBe(upstream);
    expect(bindingsForChord(state, "Mod-Shift-j").length).toBeGreaterThan(0);
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
