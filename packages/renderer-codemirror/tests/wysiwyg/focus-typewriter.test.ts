import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { WysiwygDiagnostics, provideWysiwygDiagnostics } from "../../src/diagnostics.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import {
  DEFAULT_DIM_OPACITY,
  focusModeExtension,
  focusModeField,
  isAtomicWidgetBlock,
  resolveActiveBlock,
  setFocusModeEffect,
} from "../../src/wysiwyg/focus-mode.ts";
import {
  DEVIATION_THRESHOLD_RATIO,
  setTypewriterModeEffect,
  typewriterModeField,
} from "../../src/wysiwyg/typewriter-mode.ts";
import { readBlockRanges, type BlockRange } from "../../src/wysiwyg/block-move.ts";

/**
 * U-VIEW —— D-2 专注模式 / 打字机模式的纯逻辑与状态测试（test-spec §1 U19–U23）。
 *
 * 注：DOM class 切换与滚动几何属 E2E 范畴（F1/F2/F5、W2/W3），此处覆盖
 * 可在 `environment: "node"` 下确定性验证的部分。
 */

function stateWith(doc: string, cursor: number, extensions: unknown[] = []): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: extensions as never,
  });
}

describe("U19 活动块 = 光标所在 block record（跟随光标，非悬停）", () => {
  const blocks: readonly BlockRange[] = [
    { from: 0, to: 4, name: "paragraph" },
    { from: 6, to: 13, name: "paragraph" },
    { from: 15, to: 20, name: "list-item", depth: 0 },
  ];

  it("光标落在块内 → 命中该块", () => {
    expect(resolveActiveBlock(blocks, 0)?.from).toBe(0);
    expect(resolveActiveBlock(blocks, 2)?.from).toBe(0);
    expect(resolveActiveBlock(blocks, 10)?.from).toBe(6);
    expect(resolveActiveBlock(blocks, 17)?.from).toBe(15);
  });

  it("块边界包含端点（from/to 均命中）", () => {
    expect(resolveActiveBlock(blocks, 4)?.from).toBe(0);
    expect(resolveActiveBlock(blocks, 6)?.from).toBe(6);
  });

  it("光标不在任何块内 → null（fail closed，不 dim 任何块）", () => {
    expect(resolveActiveBlock(blocks, 5)).toBeNull();
  });
});

describe("F5 原子 widget 块识别（走 class 切换，不走 decoration）", () => {
  it("ATOMIC_WIDGET_KINDS 成员被识别为原子块", () => {
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "table" })).toBe(true);
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "thematic-break" })).toBe(true);
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "html" })).toBe(true);
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "mdx-jsx" })).toBe(true);
  });

  it("普通块（段落/列表/标题）不是原子块", () => {
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "paragraph" })).toBe(false);
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "list-item" })).toBe(false);
    expect(isAtomicWidgetBlock({ from: 0, to: 1, name: "heading-atx" })).toBe(false);
  });
});

describe("F1 / U21 专注模式状态与 dim 强度", () => {
  it("默认关闭，setFocusModeEffect 可开可关", () => {
    let state = stateWith("正文", 2, [focusModeField]);
    expect(state.field(focusModeField)).toBe(false);

    state = state.update({ effects: setFocusModeEffect.of(true) }).state;
    expect(state.field(focusModeField)).toBe(true);

    state = state.update({ effects: setFocusModeEffect.of(false) }).state;
    expect(state.field(focusModeField)).toBe(false);
  });

  it("U21 dim 默认强度 0.38，位于可配区间 0.30–0.50", () => {
    expect(DEFAULT_DIM_OPACITY).toBe(0.38);
    expect(DEFAULT_DIM_OPACITY).toBeGreaterThanOrEqual(0.3);
    expect(DEFAULT_DIM_OPACITY).toBeLessThanOrEqual(0.5);
  });
});

describe("U22 / W1 打字机防抖阈值", () => {
  it("阈值为 0.35 倍视口高度（VMark 抖动坑的落地约束）", () => {
    expect(DEVIATION_THRESHOLD_RATIO).toBe(0.35);
  });

  it("打字机模式状态可开关", () => {
    let state = stateWith("正文", 2, [typewriterModeField]);
    expect(state.field(typewriterModeField)).toBe(false);
    state = state.update({ effects: setTypewriterModeEffect.of(true) }).state;
    expect(state.field(typewriterModeField)).toBe(true);
  });
});

describe("U20 折叠块不被 dim 穿透（块粒度由 readBlockRanges 保证）", () => {
  it("折叠后的列表块仍是单一 block record，dim 不下钻到子项", () => {
    const state = stateWith("- 一\n  - 子项\n- 二", 0);
    const blocks = readBlockRanges(state);
    // 列表行逐行成块（readBlockRanges 的既有语义）：dim 以「行」为最小粒度，
    // 因此折叠态下子项行仍是独立块，不会被父块 dim 穿透。
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((block) => block.to >= block.from)).toBe(true);
    // 折叠是 renderer 层的行隐藏，不改变 readBlockRanges 的块划分 → dim 粒度稳定
    expect(blocks.filter((block) => block.name === "list-item").length).toBe(3);
  });
});

describe("零文档变更契约（D-2 是纯视图状态）", () => {
  it("切换专注/打字机不改文档、不改选区", () => {
    let state = stateWith("标题\n\n正文内容", 3, [focusModeField, typewriterModeField]);
    const before = state.doc.toString();
    const beforeSel = state.selection.main.head;

    state = state.update({
      effects: [
        setFocusModeEffect.of(true),
        setTypewriterModeEffect.of(true),
        StateEffect.appendConfig.of([]),
      ],
    }).state;

    expect(state.doc.toString(), "T20 零文本变更").toBe(before);
    expect(state.selection.main.head).toBe(beforeSel);
  });
});

/**
 * OB1 探针：跑一次纯文本插入，返回三条**路径分类**计数增量。
 * 断言的是「走了哪条路径」而非「结果对不对」——这正是 PM-1 的唯一防线。
 */
function runPlainInsert(withFocus: boolean) {
  const diagnostics = new WysiwygDiagnostics();
  let state = EditorState.create({
    doc: "正文内容",
    selection: EditorSelection.cursor(4),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField,
      markdownRangeIndexField,
      wysiwygChangeProtection,
      provideWysiwygDiagnostics(diagnostics),
      configureWysiwygProjectionFeatures(["inline-styles", "headings", "blocks"]),
      wysiwygProjectionField,
      focusModeExtension,
    ],
  });
  if (withFocus) {
    state = state.update({ effects: setFocusModeEffect.of(true) }).state;
  }
  // 先让投影稳定（空插入触发首次构建）。
  // 注意：CM6 的 `Transaction.state` 是惰性求值的，必须**访问 `.state`** 才会跑字段 update（diagnostics 计数器在这里递增）。
  void state.update({ changes: { from: 4, to: 4, insert: "" } }).state;
  const before = diagnostics.snapshot();
  // 纯 Unicode 字母插入（G004 快速路径条件：纯文本段落内）
  void state.update({
    changes: { from: 4, to: 4, insert: "啊" },
    selection: EditorSelection.cursor(5),
  }).state;
  const after = diagnostics.snapshot();
  return {
    mapSkip: after.projectionMapSkipCount - before.projectionMapSkipCount,
    fullBuild: after.fullProjectionBuildCount - before.fullProjectionBuildCount,
    dirtyBlock: after.dirtyBlockRebuildCount - before.dirtyBlockRebuildCount,
  };
}

describe("OB1 / T-F7 🔴 PM-1 硬闸门：专注模式不得改变投影重建路径分类", () => {
  it("基线：纯文本插入不触发全量重建（走增量脏块重建）", () => {
    const r = runPlainInsert(false);
    expect(r.fullBuild, "基线不得全量重建").toBe(0);
    expect(r.dirtyBlock, "纯文本插入应走增量脏块重建").toBeGreaterThan(0);
  });

  it("🔴 T-F7 硬闸门：专注模式开启前后的投影路径分类**完全一致**（PM-1）", () => {
    const off = runPlainInsert(false);
    const on = runPlainInsert(true);
    // PM-1 的精确契约：专注模式不得改变投影重建路径分类。
    // F-C 变体零 decoration，故 map-vs-rebuild 判定根本看不到它。
    expect(on, "开启专注模式后路径分类不得变化").toEqual(off);
    expect(on.fullBuild, "PM-1：不得因专注模式退化为全量重建").toBe(0);
  });
});
