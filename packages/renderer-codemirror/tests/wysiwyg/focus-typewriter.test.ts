import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
} from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import { WysiwygDiagnostics, provideWysiwygDiagnostics } from "../../src/diagnostics.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import {
  blockWidgetCoveredRanges,
  configureWysiwygProjectionFeatures,
  refreshWysiwygProjectionEffect,
  setWysiwygVisibleRangesEffect,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";
import {
  DEFAULT_DIM_OPACITY,
  focusDimDecorationsField,
  focusModeExtension,
  focusModeField,
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

describe("U19b 活动块二分查找（readBlockRanges 保证升序不嵌套）", () => {
  const many: readonly BlockRange[] = Array.from({ length: 500 }, (_unused, index) => ({
    from: index * 10,
    to: index * 10 + 4,
    name: "paragraph",
  }));

  it("大列表下的命中与边界（含端点）", () => {
    expect(resolveActiveBlock(many, 0)?.from).toBe(0);
    expect(resolveActiveBlock(many, 4)?.from).toBe(0);
    expect(resolveActiveBlock(many, 2504)?.from).toBe(2500);
    expect(resolveActiveBlock(many, 4994)?.from).toBe(4990);
  });

  it("块间空隙 → null", () => {
    expect(resolveActiveBlock(many, 5)).toBeNull();
    expect(resolveActiveBlock(many, 4995)).toBeNull();
  });
});

describe("F5 所有权契约：块 widget 覆盖的行不得挂 focus 线装饰", () => {
  // 判据取自**投影层渲染契约**（layoutDecorations 中 spec.block === true），
  // 故 setext 标题 / 引用定义 / 脚注定义 / 表格这些「不在旧 kind 名单内」的
  // 整块 replace widget 也必须在跳过名单内（否则同位置线装饰造幻影行/块消失）。
  const doc = [
    "Setext 标题",
    "===========",
    "",
    "普通段落甲，应被线装饰覆盖。",
    "",
    "[ref]: https://example.com/only",
    "",
    "脚注引用示例。[^1]",
    "",
    "[^1]: 脚注定义内容",
    "",
    "普通段落乙，应被线装饰覆盖。",
    "",
    "| 列一 | 列二 |",
    "| --- | --- |",
    "| 单元 | 数据 |",
    "",
    "    indented code line one",
    "    indented code line two",
    "",
  ].join("\n");

  function projectedState(source: string): EditorState {
    return stateWith(source, 0, [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS }),
      provideWysiwygDiagnostics(new WysiwygDiagnostics()),
      editorModeField,
      markdownRangeIndexField,
      // 投影构建在读 code 块 record 时会取该字段（`projection-state.ts` 的
      // `buildLayoutDecorationsForRecord`），故含代码块的夹具必须注册它，
      // 否则一旦惰性求值投影就会抛 “Field is not present in this state”。
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
      focusModeExtension,
    ]);
  }

  it("整块 replace widget 的行被跳过，普通段落仍被覆盖（对照组）", () => {
    let state = projectedState(doc);
    state = state.update({ effects: setFocusModeEffect.of(true) }).state;
    const decorated = new Set(focusDecorationPositions(state));

    const skipped: readonly [string, string][] = [
      ["setext 标题", "Setext 标题"],
      ["引用定义", "[ref]: https://example.com/only"],
      ["脚注定义", "[^1]: 脚注定义内容"],
      ["表格", "| 列一 | 列二 |"],
    ];
    for (const [label, text] of skipped) {
      const line = state.doc.lineAt(doc.indexOf(text));
      expect(
        decorated.has(line.from),
        `${label} 所在行不得挂 focus 线装饰（否则与块 widget 同位置 → 幻影行/块消失）`,
      ).toBe(false);
    }

    // 对照组：普通段落必须仍被覆盖（证明不是把所有行都跳过了）
    for (const text of ["普通段落甲，应被线装饰覆盖。", "普通段落乙，应被线装饰覆盖。"]) {
      const line = state.doc.lineAt(doc.indexOf(text));
      expect(decorated.has(line.from), `${text} 应被 focus 线装饰覆盖`).toBe(true);
    }

    // 零长度**点 widget** 回归锁：代码块工具栏是 `Decoration.widget({block: true})` 的点装饰，
    // 不“覆盖该行” ⇒ 不得因此把该行排除在 dim 之外（缩进代码块的首个正文行必须仍被覆盖）。
    const codeLine = state.doc.lineAt(doc.indexOf("indented code line one"));
    expect(
      decorated.has(codeLine.from),
      "缩进代码块首行必须仍被 focus 线装饰覆盖（点 widget 不构成行覆盖）",
    ).toBe(true);
  });

  it("投影层共享判据 blockWidgetCoveredRanges 覆盖四类整块 widget，且排除零长度点 widget", () => {
    const state = projectedState(doc);
    const covered = blockWidgetCoveredRanges(state);
    const texts = covered.map((range) =>
      state.sliceDoc(range.from, Math.min(range.to, range.from + 16)),
    );
    expect(
      texts.some((text) => text.startsWith("Setext 标题")),
      "setext 标题",
    ).toBe(true);
    expect(
      texts.some((text) => text.startsWith("[ref]:")),
      "引用定义",
    ).toBe(true);
    expect(
      texts.some((text) => text.startsWith("[^1]:")),
      "脚注定义",
    ).toBe(true);
    expect(
      texts.some((text) => text.includes("| 列一 |")),
      "表格",
    ).toBe(true);
    // 零长度点 widget（代码块工具栏/spacer）不得进入覆盖集合
    expect(
      covered.every((range) => range.to > range.from),
      "零长度点 widget 不得算行覆盖",
    ).toBe(true);
  });
});

describe("C：装饰集只对可见区注入 effect 重建（无关 effect 不得触发全量重建）", () => {
  const unrelatedEffect = StateEffect.define<number>();
  const source = Array.from({ length: 60 }, (_unused, index) => `# Line ${index} content`).join(
    "\n",
  );

  it("无关 effect → 同一装饰集对象；可见区 effect → 新对象", () => {
    let state = stateWith(source, 0, [
      markdownRangeIndexField,
      editorModeField,
      configureWysiwygProjectionFeatures(["blocks", "headings"]),
      wysiwygProjectionField,
      focusModeExtension,
    ]);
    state = state.update({ effects: setFocusModeEffect.of(true) }).state;
    const before = state.field(focusDimDecorationsField);

    state = state.update({ effects: unrelatedEffect.of(1) }).state;
    expect(
      state.field(focusDimDecorationsField),
      "无关 effect（如解析进度/原子选区）不得触发专注装饰重建",
    ).toBe(before);

    state = state.update({
      effects: setWysiwygVisibleRangesEffect.of([{ from: 0, to: 50 }]),
    }).state;
    expect(state.field(focusDimDecorationsField), "可见区注入必须重建").not.toBe(before);
  });

  it("投影渲染契约变化（无文档/选区变化）必须与专注装饰集同步失效", () => {
    // 不枚举 effect，而断言**依赖耦合**本身：只要投影的 layoutDecorations 身份变了，
    // 专注装饰集就必须换新（否则留下陈旧装饰集，行装饰与块 widget 同位置共存 → 幻影行回归）。
    // 该不变量对**任何**重建投影的 effect 成立，无需逐个登记；
    // 旧实现（枚举两条 effect）会漏掉解析覆盖率刷新 / 投影刷新这类 effect。
    let state = stateWith(source, 0, [
      markdownRangeIndexField,
      editorModeField,
      configureWysiwygProjectionFeatures(["blocks", "headings"]),
      wysiwygProjectionField,
      focusModeExtension,
    ]);
    state = state.update({ effects: setFocusModeEffect.of(true) }).state;

    for (const effect of [
      refreshWysiwygProjectionEffect.of(null),
      refreshMarkdownParseCoverageEffect.of(null),
    ]) {
      const beforeProjection = state.field(wysiwygProjectionField);
      const beforeFocus = state.field(focusDimDecorationsField);
      state = state.update({ effects: effect }).state;
      const projectionChanged = state.field(wysiwygProjectionField) !== beforeProjection;
      expect(
        state.field(focusDimDecorationsField) !== beforeFocus,
        "专注装饰集必须与投影渲染契约同步失效（依赖耦合不变量）",
      ).toBe(projectionChanged);
    }
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
    // F-C 装饰集是**独立** StateField（`focusDimDecorationsField`），不参与
    // `wysiwygProjectionField` 的 map-vs-rebuild 判定，故该分类看不到它。
    expect(on, "开启专注模式后路径分类不得变化").toEqual(off);
    expect(on.fullBuild, "PM-1：不得因专注模式退化为全量重建").toBe(0);
  });
});

function focusDecorationPositions(state: EditorState): readonly number[] {
  const positions: number[] = [];
  state.field(focusDimDecorationsField).between(0, state.doc.length, (from, _to, value) => {
    if (String(value.spec.class ?? "").startsWith("cm-md-focus-")) {
      positions.push(from);
    }
  });
  return positions;
}

describe("F6/OB2（G006 方案 b）：专注装饰走视口过滤 + 生产全文构建明说", () => {
  it("2000 行夹具 + effect 注入可见区 → 只构建可见区（G006 视口过滤）；未注入 = 全文构建", () => {
    // ⚠️ 方案(b) 明说（PRD R-6）：生产当前是**全文构建** —— probe 有意 no-op，生产不派发
    // setWysiwygVisibleRangesEffect；本测试走 effect 注入路径驱动 G006（F6/OB2 改写约定）。
    const fixture = Array.from(
      { length: 2000 },
      (_unused, index) => `# Line ${index} content`,
    ).join("\n");
    let state = stateWith(fixture, 0, [
      markdownRangeIndexField,
      editorModeField,
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
      focusModeExtension,
    ]);
    state = state.update({ effects: setFocusModeEffect.of(true) }).state;

    // 未注入可见区 → 全文构建（明说的生产现状）
    const full = focusDecorationPositions(state);
    expect(full.length, "全文构建：绝大多数行都有 focus 装饰").toBeGreaterThan(1000);

    // 注入可见区 [1000,1100) → 只构建与可见区相交的块
    state = state.update({
      effects: setWysiwygVisibleRangesEffect.of([{ from: 1000, to: 1100 }]),
    }).state;
    const limited = focusDecorationPositions(state);
    expect(limited.length, "限定构建：装饰数远少于全文").toBeGreaterThan(0);
    expect(limited.length).toBeLessThan(full.length / 10);
    for (const pos of limited) {
      expect(pos, `装饰位置 ${pos} 必须落在可见区邻域（块相交规则）`).toBeGreaterThanOrEqual(900);
      expect(pos).toBeLessThanOrEqual(1120);
    }
  });
});
