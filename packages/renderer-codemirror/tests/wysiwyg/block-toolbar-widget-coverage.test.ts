import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import { blockDecorationsFromRanges } from "../../src/wysiwyg/block-toolbar.ts";
import { readBlockRanges } from "../../src/wysiwyg/block-move.ts";
import {
  blockWidgetCoveredRanges,
  configureWysiwygProjectionFeatures,
  projectionStateChangedBetween,
  setWysiwygVisibleRangesEffect,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";

/**
 * 块工具栏 × 块 widget 覆盖范围。
 *
 * 锁定契约：**块 widget 覆盖的行不得挂行装饰** —— 同位置 `Decoration.line` 与整块
 * replace 装饰冲突，会经 CM 的 `addLineStartIfNotCovered` 产生幻影行 / 让块消失（F5）。
 * 该契约原先由块工具栏自己的 kind 名单（`ATOMIC_WIDGET_KINDS`，只含 4 个 kind）表达，
 * 漏掉 setext 标题 / 引用定义 / 脚注定义；现与专注模式共用**投影层渲染契约**。
 *
 * 覆盖边界（如实声明）：`blockDecorationsFromRanges` 是 state 纯函数（widget 仅在 `toDOM`
 * 时才需 DOM），故可在 node 环境直接验证装饰集内容与共享失效契约。
 * **未覆盖**：ViewPlugin 的装配/重建接线（`projectionStateChanged(update)` 触发重算）需真实 DOM。
 * 该接线的保障是**结构性**的 —— 两个消费者共用同一个 helper 与同一个判据，且守卫项只是一次调用；
 * 本文件不声称 E2E 覆盖了它（E20/E21 覆盖的是**专注模式**路径的 DOM 不变量，不是工具栏插件的重算）。
 */

const doc = [
  "Setext 标题",
  "===========",
  "",
  "普通段落甲。",
  "",
  "[ref]: https://example.com/only",
  "",
  "脚注引用示例。[^1]",
  "",
  "[^1]: 脚注定义内容",
  "",
  "普通段落乙。",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 单元 | 数据 |",
  "",
].join("\n");

function projectedState(source: string): EditorState {
  return EditorState.create({
    doc: source,
    selection: EditorSelection.cursor(0),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      editorModeField,
      markdownRangeIndexField,
      // 投影构建读 code 块 record 时会取该字段（projection-state.ts 的
      // buildLayoutDecorationsForRecord），缺失会在惰性求值投影时抛错。
      codeBlockLineNumbersField,
      configureWysiwygProjectionFeatures([
        "inline-styles",
        "headings",
        "blocks",
        "links",
        "images",
        "thematic-breaks",
        "default-atoms",
        "frontmatter",
        "tables",
        "html",
        "mdx",
      ]),
      wysiwygProjectionField,
    ] as never,
  });
}

/** 工具栏行装饰的落点（`data-block-from` 标记） */
function toolbarLinePositions(state: EditorState): readonly number[] {
  const positions: number[] = [];
  blockDecorationsFromRanges(state, readBlockRanges(state)).between(
    0,
    state.doc.length,
    (from, _to, value) => {
      if (value.spec?.attributes?.["data-block-from"] !== undefined) {
        positions.push(from);
      }
    },
  );
  return positions;
}

describe("块工具栏：块 widget 覆盖行不得挂行装饰（与专注模式共用投影渲染契约）", () => {
  it("setext 标题 / 引用定义 / 脚注定义 / 表格所在行无行装饰，普通段落有", () => {
    const state = projectedState(doc);
    const positions = new Set(toolbarLinePositions(state));
    const covered = blockWidgetCoveredRanges(state);

    // 前置断言：夹具确实产生了四类整块 widget 覆盖（否则本用例是空转）
    expect(covered.length, "夹具必须产生整块 widget 覆盖范围").toBeGreaterThanOrEqual(4);

    const skipped: readonly [string, string][] = [
      ["setext 标题", "Setext 标题"],
      ["引用定义", "[ref]: https://example.com/only"],
      ["脚注定义", "[^1]: 脚注定义内容"],
      ["表格", "| 列一 | 列二 |"],
    ];
    for (const [label, text] of skipped) {
      const line = state.doc.lineAt(doc.indexOf(text));
      expect(positions.has(line.from), `${label} 所在行不得挂行装饰（同位置会造幻影行）`).toBe(
        false,
      );
    }

    // 对照组：普通段落仍须有行装饰（证明不是把全部行都跳过了）
    for (const text of ["普通段落甲。", "普通段落乙。"]) {
      const line = state.doc.lineAt(doc.indexOf(text));
      expect(positions.has(line.from), `${text} 应挂行装饰`).toBe(true);
    }
  });

  it("共享失效契约：投影变化为真、无关 effect 为假（工具栏重建守卫的输入）", () => {
    const before = projectedState(doc);
    const after = before.update({
      effects: setWysiwygVisibleRangesEffect.of([{ from: 0, to: 40 }]),
    }).state;
    expect(
      projectionStateChangedBetween(before, after),
      "投影重建必须被判为变化（否则工具栏会留下陈旧装饰集）",
    ).toBe(true);

    const unrelatedEffect = StateEffect.define<null>();
    const unrelated = after.update({ effects: unrelatedEffect.of(null) }).state;
    expect(
      projectionStateChangedBetween(after, unrelated),
      "无关 effect 不得被判为投影变化（否则工具栏做无谓重建）",
    ).toBe(false);
  });

  it("投影变化后重算，契约仍成立（覆盖范围与装饰集同步）", () => {
    let state = projectedState(doc);
    state = state.update({
      effects: setWysiwygVisibleRangesEffect.of([{ from: 0, to: 40 }]),
    }).state;
    const positions = new Set(toolbarLinePositions(state));
    for (const range of blockWidgetCoveredRanges(state)) {
      const line = state.doc.lineAt(range.from);
      expect(positions.has(line.from), "投影变化后仍不得在覆盖行挂行装饰").toBe(false);
    }
  });
});
