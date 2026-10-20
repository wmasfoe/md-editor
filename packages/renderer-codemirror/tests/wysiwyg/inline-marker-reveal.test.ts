/**
 * T-4…T-11（含 T-11b/T-11c）：显形点集派生语义与新鲜度契约。
 */
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import {
  markdownRangeIndexField,
  syntaxPluginRegistryFacet,
} from "../../src/markdown/range-index.ts";
import { SyntaxPluginRegistry } from "../../src/plugins/syntax-registry.ts";
import { freezeProjectionState, type ProjectionStateDraft } from "../../src/wysiwyg/state/atoms.ts";
import {
  EMPTY_REVEAL_IDS,
  resolveInlineMarkerRevealIds,
} from "../../src/wysiwyg/state/inline-marker-reveal.ts";
import { localInlineMarkdown, localInlinePlugin } from "./support/local-inline-plugin.ts";

const DOC = "Head\n\nxx **bold** yy *it* ~~del~~ `code`\n";
const HEAD = "Head\n\nplain text only\n";

function createState(doc: string, selection: EditorSelection) {
  return EditorState.create({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: [...M1_MARKDOWN_EXTENSIONS, localInlinePlugin.markdownExtension!] }),
      syntaxPluginRegistryFacet.of(new SyntaxPluginRegistry([localInlinePlugin])),
      markdownRangeIndexField,
    ],
  });
}

function recordOf(state: EditorState, kind: "bold" | "italic" | "highlight") {
  const record = state.field(markdownRangeIndexField).byKind(kind)[0];
  expect(record).toBeDefined();
  return record!;
}

function revealFor(state: EditorState, selection: EditorSelection) {
  return resolveInlineMarkerRevealIds(state.field(markdownRangeIndexField), selection, false);
}

const EMPTY_DRAFT: ProjectionStateDraft = {
  mode: "wysiwyg",
  rangeIndexVersion: 0,
  activeSyntaxIds: [],
  selectedAtomIds: [],
  compositionGuardRanges: [],
  protectedRanges: [],
  layoutDecorations: null as never,
  atomicRanges: null as never,
  lastSelectionDeltaIds: [],
  typedBoundary: null,
  visibleRanges: [],
};

/**
 * 该函数**永不执行**，只用于让 typecheck 校验 `@ts-expect-error` 是否真实成立：
 * 若品牌失效（第二参数退化为普通 `readonly string[]`），`@ts-expect-error` 会因
 * “没有错误可忽略”而让 `pnpm typecheck` 失败。
 */
function typeLevelOnly(draft: ProjectionStateDraft, plain: readonly string[]): void {
  // @ts-expect-error —— 第二参数要求 branded InlineMarkerRevealIds。
  freezeProjectionState(draft, plain);
}

describe("resolveInlineMarkerRevealIds", () => {
  it("T-4: 折叠光标在记录内部时入选", () => {
    const state = createState(DOC, EditorSelection.single(0));
    const bold = recordOf(state, "bold");
    expect(revealFor(state, EditorSelection.single(bold.fullRange.from + 3))).toContain(bold.id);
  });

  it("T-5: 折叠光标贴住记录首/尾（闭区间）时入选", () => {
    const state = createState(DOC, EditorSelection.single(0));
    const bold = recordOf(state, "bold");
    expect(revealFor(state, EditorSelection.single(bold.fullRange.from))).toContain(bold.id);
    expect(revealFor(state, EditorSelection.single(bold.fullRange.to))).toContain(bold.id);
  });

  it("T-6: 折叠光标在记录外 1 个字符时不入选", () => {
    const state = createState(DOC, EditorSelection.single(0));
    const bold = recordOf(state, "bold");
    expect(revealFor(state, EditorSelection.single(bold.fullRange.from - 1))).not.toContain(
      bold.id,
    );
  });

  it("T-7/T-8: 范围选区贴边（零重叠）也入选——这是相对 activeSyntaxIds 的唯一净增量", () => {
    const state = createState(DOC, EditorSelection.single(0));
    const bold = recordOf(state, "bold");
    const index = state.field(markdownRangeIndexField);

    expect(
      revealFor(state, EditorSelection.single(bold.fullRange.from - 2, bold.fullRange.from)),
    ).toContain(bold.id);
    expect(
      revealFor(state, EditorSelection.single(bold.fullRange.to, bold.fullRange.to + 2)),
    ).toContain(bold.id);
    // 对照：全局激活契约（overlapping）对同一贴边范围不命中（T-3 已锁定，此处再证一次）。
    expect(
      index
        .overlapping(bold.fullRange.from - 2, bold.fullRange.from)
        .some((record) => record.id === bold.id),
    ).toBe(false);
  });

  it("T-9: 非白名单 kind（本地插件 highlight）不入选", () => {
    const doc = localInlineMarkdown();
    const state = createState(doc, EditorSelection.single(0));
    const plugin = recordOf(state, "highlight");
    expect(revealFor(state, EditorSelection.single(plugin.fullRange.from + 2))).not.toContain(
      plugin.id,
    );
  });

  it("T-10: 开关 ON 时返回冻结常数空集（同一引用）", () => {
    const state = createState(DOC, EditorSelection.single(0));
    const ids = resolveInlineMarkerRevealIds(
      state.field(markdownRangeIndexField),
      state.selection,
      true,
    );
    expect(ids).toBe(EMPTY_REVEAL_IDS);
    expect(Object.isFrozen(ids)).toBe(true);
    expect(ids).toHaveLength(0);
  });

  it("T-11: 无任何触及记录时同样复用冻结常数（不白分配）", () => {
    const state = createState(HEAD, EditorSelection.single(1));
    expect(revealFor(state, state.selection)).toBe(EMPTY_REVEAL_IDS);
  });

  it("T-19（AC-9-D）: touching 调用次数 = selection range 数，与文档长度无关", () => {
    // 代理指标：resolver 每个 selection range 只做一次区间查询（二分候选 + 线性扫），
    // 因此“每事务查询次数”只随 range 数增长，不随文档长度增长。
    const calls: Array<{ from: number; to: number }> = [];
    const fakeIndex = {
      touching(from: number, to: number) {
        calls.push({ from, to });
        return [];
      },
    } as unknown as Parameters<typeof resolveInlineMarkerRevealIds>[0];

    const single = EditorSelection.single(3);
    resolveInlineMarkerRevealIds(fakeIndex, single, false);
    expect(calls).toHaveLength(1);

    const multi = EditorSelection.create([
      EditorSelection.cursor(3),
      EditorSelection.cursor(40),
      EditorSelection.cursor(900),
    ]);
    calls.length = 0;
    resolveInlineMarkerRevealIds(fakeIndex, multi, false);
    expect(calls).toHaveLength(3);

    // 开关 ON 直接短路，一次查询都不做（ON 模式不付该成本）。
    calls.length = 0;
    resolveInlineMarkerRevealIds(fakeIndex, multi, true);
    expect(calls).toHaveLength(0);
  });

  it("T-11b: branded 类型阻断“把上一状态的旧数组直接回传”（编译期）", () => {
    expect(typeof typeLevelOnly).toBe("function");
  });

  it("T-11c: 冻结结果恒等于第二参数（堵 noUnusedParameters 缺口）", () => {
    const state = createState(DOC, EditorSelection.single(0));
    const bold = recordOf(state, "bold");
    const fresh = revealFor(state, EditorSelection.single(bold.fullRange.from + 2));
    expect(fresh.length).toBeGreaterThan(0);

    const frozen = freezeProjectionState(
      // 故意塞入陈旧值：实现若从 `...state` 透传而非取第二参数，本断言即失败。
      { ...EMPTY_DRAFT, inlineMarkerRevealIds: Object.freeze(["stale"]) } as ProjectionStateDraft,
      fresh,
    );

    expect(frozen.inlineMarkerRevealIds).toEqual([...fresh]);
    expect(frozen.inlineMarkerRevealIds).not.toContain("stale");
  });
});
