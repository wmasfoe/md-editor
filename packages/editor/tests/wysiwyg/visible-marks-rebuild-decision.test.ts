/**
 * T-22…T-25：`shouldRebuildVisibleMarks` 的失效判据（合成 ViewUpdate 层）。
 *
 * 仓库 vitest 为 node 环境、无 jsdom，故此处只验证**纯决策函数**；
 * 真实 ViewPlugin 生命周期与 DOM 装饰由 L3（Playwright）覆盖。
 * 合成 update 必须同时提供 `view: { composing, visibleRanges }`（见 test-spec 约定 2）。
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { editorModeField } from "../../src/mode.ts";
import {
  inlineStyleMarkersField,
  setInlineStyleMarkersEffect,
} from "../../src/wysiwyg/projections/inline-heading.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";
import {
  shouldHoldVisibleMarks,
  shouldRebuildVisibleMarks,
} from "../../src/wysiwyg/state/visible-marks.ts";
import { startWysiwygCompositionGuardEffect } from "../../src/wysiwyg/state/types.ts";

const DOC = "Head\n\nxx **bold** yy plain\n";

function createState() {
  return EditorState.create({
    doc: DOC,
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      editorModeField,
      markdownRangeIndexField,
      configureWysiwygProjectionFeatures(["inline-styles", "headings"]),
      wysiwygProjectionField,
      inlineStyleMarkersField,
    ],
  });
}

function syntheticUpdate(
  startState: EditorState,
  state: EditorState,
  viewportChanged = false,
  transactions: readonly Transaction[] = [],
): ViewUpdate {
  return {
    startState,
    state,
    viewportChanged,
    docChanged: startState.doc !== state.doc,
    focusChanged: false,
    composing: false,
    transactions,
    changes: startState.changes({ from: 0, to: 0, insert: "" }),
    view: {
      composing: false,
      visibleRanges: [{ from: 0, to: state.doc.length }],
    },
  } as unknown as ViewUpdate;
}

function boldOffset(state: EditorState): number {
  const record = state.field(markdownRangeIndexField).byKind("bold")[0];
  expect(record).toBeDefined();
  return record!.fullRange.from + 2;
}

describe("shouldRebuildVisibleMarks", () => {
  it("T-22: 无关事务（无 doc/viewport/投影身份变化）不重建", () => {
    const state = createState();
    expect(shouldRebuildVisibleMarks(syntheticUpdate(state, state))).toBe(false);
  });

  it("T-23: viewportChanged ⇒ 重建", () => {
    const state = createState();
    expect(shouldRebuildVisibleMarks(syntheticUpdate(state, state, true))).toBe(true);
  });

  it("T-24: 选区内激活集变化（投影身份变化）⇒ 重建", () => {
    const state = createState();
    const next = state.update({ selection: EditorSelection.single(boldOffset(state)) }).state;
    expect(shouldRebuildVisibleMarks(syntheticUpdate(state, next))).toBe(true);
  });

  it("T-25: 显隐开关的 effect 事务 ⇒ 重建（P0-2 的 node 等价锁）", () => {
    const state = createState();
    const next = state.update({ effects: setInlineStyleMarkersEffect.of(true) }).state;
    expect(shouldRebuildVisibleMarks(syntheticUpdate(state, next))).toBe(true);
  });

  it("T-25c: compositionstart 事务也必须 hold（否则 IME 刚接管 DOM 就被重建打断）", () => {
    const state = createState();
    const transaction = state.update({
      effects: startWysiwygCompositionGuardEffect.of([{ from: 0, to: 0 }]),
    });
    const update = syntheticUpdate(state, transaction.state, false, [transaction]);
    // 投影身份确实变化（guard ranges 变了）⇒ 重建判据为 true，但必须被 hold 拦住。
    expect(shouldRebuildVisibleMarks(update)).toBe(true);
    expect(shouldHoldVisibleMarks(update)).toBe(true);
  });

  it("T-25d: 普通文档输入不 hold（正常重建路径不受影响）", () => {
    const state = createState();
    const next = state.update({ changes: { from: 2, insert: "x" } }).state;
    expect(shouldHoldVisibleMarks(syntheticUpdate(state, next))).toBe(false);
  });

  it("T-25b: 开关切换后再次无关事务不重建（避免每帧重建）", () => {
    const toggled = createState().update({ effects: setInlineStyleMarkersEffect.of(true) }).state;
    expect(shouldRebuildVisibleMarks(syntheticUpdate(toggled, toggled))).toBe(false);
  });
});
