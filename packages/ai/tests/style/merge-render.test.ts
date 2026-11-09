import { describe, expect, it } from "vitest";

import {
  STYLE_PRIORITY_CONTRACT,
  STYLE_TOLERANCE_CONTRACT,
  estimateStyleTokens,
  mergeStyleProfile,
  mergedStyleValue,
  renderStylePrefix,
  renderStyleTolerancePrefix,
  type StyleRuleRecord,
} from "../../src/style/index.ts";
import { applyObservations, observeGlobal } from "../../src/style/engine-entry.ts";
import { FIVE_FILES, activeRule, round, workspace } from "./fixtures.ts";

describe("style profile merge", () => {
  it("U-MG-1: custom > workspace > global per dimension, with inheritance", () => {
    const merged = mergeStyleProfile({
      global: [activeRule("paragraphLength", "short"), activeRule("termScript", "keep-english")],
      workspace: [activeRule("paragraphLength", "long"), activeRule("formality", "formal")],
      custom: [{ kind: "dimension", id: "c1", dimension: "formality", value: "casual" }],
    });
    expect(merged.rules.map((rule) => [rule.dimension, rule.value, rule.layer])).toEqual([
      ["paragraphLength", "long", "workspace"],
      ["termScript", "keep-english", "global"],
      ["formality", "casual", "custom"],
    ]);
    expect(mergedStyleValue(merged, "termScript")).toBe("keep-english");
  });

  it("U-MG-2: drafts and retired rules are excluded; none disables; notes are appended", () => {
    const draft: StyleRuleRecord = {
      dimension: "listUsage",
      value: "rare",
      status: "draft",
      rounds: [],
    };
    const retired: StyleRuleRecord = { ...draft, dimension: "sentenceLength", status: "retired" };
    const merged = mergeStyleProfile({
      workspace: [
        draft,
        retired,
        activeRule("cjkLatinSpacing", "spaced"),
        activeRule("formality", "formal"),
      ],
      custom: [
        { kind: "dimension", id: "c1", dimension: "formality", value: "none" },
        { kind: "note", id: "n1", text: "  第一人称用“我们”。 " },
        { kind: "note", id: "n2", text: "   " },
      ],
    });
    expect(merged.rules).toEqual([
      {
        layer: "workspace",
        dimension: "cjkLatinSpacing",
        value: "spaced",
        text: "中文与英文、数字之间加空格。",
      },
      { layer: "custom", text: "第一人称用“我们”。" },
    ]);
  });

  it("U-MG-3: global candidates need the same active value in at least two linked workspaces", () => {
    const a = workspace("a", {
      rules: [
        { ...activeRule("termScript", "keep-english"), rounds: [round(3, "keep-english", ["x"])] },
      ],
    });
    const b = workspace("b", {
      rules: [
        { ...activeRule("termScript", "keep-english"), rounds: [round(3, "keep-english", ["y"])] },
      ],
    });
    const c = workspace("c", {
      rules: [activeRule("termScript", "keep-english")],
      linkState: "unlinked",
    });
    expect(observeGlobal([a], 1).termScript?.value).toBe("unknown");
    expect(observeGlobal([a, c], 1).termScript?.value).toBe("unknown");
    const both = observeGlobal([a, b], 1).termScript;
    expect(both).toMatchObject({ value: "keep-english", supportSampleIds: ["a:x", "b:y"] });

    const conflicting = workspace("d", { rules: [activeRule("termScript", "translate")] });
    expect(observeGlobal([a, b, conflicting], 1).termScript?.value).toBe("unknown");

    // 全局候选同样要经过多轮确认才生效。
    const many = Array.from({ length: 5 }, (_, i) =>
      workspace(`w${i}`, {
        rules: [{ ...activeRule("formality", "formal"), rounds: [round(1, "formal", FIVE_FILES)] }],
      }),
    );
    let rules: StyleRuleRecord[] = [];
    for (const n of [1, 2]) {
      rules = applyObservations(rules, observeGlobal(many, n));
    }
    expect(rules.find((rule) => rule.dimension === "formality")?.status).toBe("draft");
    rules = applyObservations(rules, observeGlobal(many, 3));
    expect(rules.find((rule) => rule.dimension === "formality")?.status).toBe("active");
  });
});

describe("style prefix rendering", () => {
  const merged = mergeStyleProfile({
    workspace: [
      activeRule("termScript", "keep-english"),
      activeRule("cjkLatinSpacing", "spaced"),
      activeRule("organization", "conclusion-first"),
    ],
    custom: [{ kind: "note", id: "n1", text: "少用感叹号。" }],
  });

  it("U-RD-1 and U-RD-3: renders only rule text under the priority contract", () => {
    const prefix = renderStylePrefix(merged);
    expect(prefix).toMatchInlineSnapshot(`
      "[写作偏好]
      以下是用户的写作偏好，优先级低于当前文章已有的语言、语气与格式，以及用户本次明确指令；冲突时以后者为准。
      - 中文与英文、数字之间加空格。
      - 技术术语保留英文原文，不翻译。
      - 先给结论，再解释原因。
      - 少用感叹号。"
    `);
    expect(prefix.split("\n")[1]).toBe(STYLE_PRIORITY_CONTRACT);
    expect(prefix).not.toMatch(/termScript|keep-english|workspace|\.md|n1|sha/u);
    expect(renderStylePrefix(undefined)).toBe("");
    expect(renderStylePrefix({ rules: [] })).toBe("");
  });

  it("U-RD-2: truncates by layer and weight within the token budget", () => {
    const notes = Array.from({ length: 30 }, (_, index) => ({
      kind: "note" as const,
      id: `n${index}`,
      text: `第 ${index} 条很长的自定义偏好，用来把前缀撑满预算。`,
    }));
    const big = mergeStyleProfile({
      workspace: [activeRule("termScript", "keep-english")],
      custom: notes,
    });
    const prefix = renderStylePrefix(big);
    expect(estimateStyleTokens(prefix)).toBeLessThanOrEqual(200);
    // 自定义层优先保留，被截断的是排在后面的同层规则。
    expect(prefix).toContain("第 0 条");
    expect(prefix).not.toContain("第 29 条");
  });

  it("U-RD-4: the grammar-fix variant only lists mechanical habits", () => {
    const prefix = renderStyleTolerancePrefix(merged);
    expect(prefix.split("\n")[1]).toBe(STYLE_TOLERANCE_CONTRACT);
    expect(prefix).toContain("技术术语保留英文原文");
    expect(prefix).toContain("中文与英文、数字之间加空格");
    expect(prefix).not.toContain("先给结论");
    expect(prefix).not.toContain("少用感叹号");
  });
});

describe("global rules stay stable across rounds", () => {
  it("does not flap once activated", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      workspace(`w${i}`, {
        rules: [
          {
            ...activeRule("formality", "formal"),
            rounds: [{ round: 1, value: "formal", supportSampleIds: FIVE_FILES }],
          },
        ],
      }),
    );
    let rules: StyleRuleRecord[] = [];
    const statuses: string[] = [];
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      rules = applyObservations(rules, observeGlobal(many, n));
      statuses.push(rules.find((rule) => rule.dimension === "formality")?.status ?? "missing");
    }
    // 生效之后不再来回切换。
    const activeFrom = statuses.indexOf("active");
    expect(activeFrom).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(activeFrom).every((status) => status === "active")).toBe(true);
  });
});

describe("global stat rules stay stable across rounds", () => {
  it("keeps a global stat rule active once promoted", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      workspace(`w${i}`, {
        rules: [
          {
            ...activeRule("sentenceLength", "short"),
            rounds: [{ round: 1, value: "short", supportSampleIds: FIVE_FILES, aggregate: 12 }],
          },
        ],
      }),
    );
    let rules: StyleRuleRecord[] = [];
    const statuses: string[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      rules = applyObservations(rules, observeGlobal(many, n));
      statuses.push(rules.find((rule) => rule.dimension === "sentenceLength")?.status ?? "missing");
    }
    const activeFrom = statuses.indexOf("active");
    expect(activeFrom).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(activeFrom).every((status) => status === "active")).toBe(true);
  });
});
