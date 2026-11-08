import { describe, expect, it } from "vitest";

import {
  ROUND_HISTORY_LIMIT,
  advanceStyleRule,
  type StyleRuleRecord,
} from "../../src/style/index.ts";
import { applyObservations, observeSamples } from "../../src/style/engine-entry.ts";
import { FIVE_FILES, round, sample } from "./fixtures.ts";

function feed(
  dimension: StyleRuleRecord["dimension"],
  rounds: ReturnType<typeof round>[],
): StyleRuleRecord {
  let rule: StyleRuleRecord | undefined;
  for (const observation of rounds) {
    rule = advanceStyleRule(dimension, rule, observation);
  }
  return rule!;
}

describe("style rule lifecycle", () => {
  it("U-LC-1: two consistent rounds stay draft; three rounds with five files activate", () => {
    expect(
      feed("formality", [round(1, "formal", FIVE_FILES), round(2, "formal", FIVE_FILES)]).status,
    ).toBe("draft");
    expect(
      feed("formality", [
        round(1, "formal", ["a", "b"]),
        round(2, "formal", ["a", "c"]),
        round(3, "formal", ["b", "d"]),
      ]).status,
    ).toBe("draft");
    expect(
      feed("formality", [
        round(1, "formal", ["a", "b"]),
        round(2, "formal", ["c", "d"]),
        round(3, "formal", ["e"]),
      ]),
    ).toMatchObject({ status: "active", value: "formal" });
    expect(
      feed("formality", [
        round(1, "formal", FIVE_FILES),
        round(2, "casual", FIVE_FILES),
        round(3, "formal", FIVE_FILES),
      ]).status,
    ).toBe("draft");
  });

  it("U-LC-2: unstable statistics do not activate", () => {
    expect(
      feed("paragraphLength", [
        round(1, "short", FIVE_FILES, 30),
        round(2, "short", FIVE_FILES, 75),
        round(3, "short", FIVE_FILES, 10),
      ]).status,
    ).toBe("draft");
    expect(
      feed("paragraphLength", [
        round(1, "short", FIVE_FILES, 60),
        round(2, "short", FIVE_FILES, 62),
        round(3, "short", FIVE_FILES, 58),
      ]).status,
    ).toBe("active");
  });

  it("U-LC-3: retires after three unsupported rounds or when support drops below five files", () => {
    const active = feed("formality", [
      round(1, "formal", FIVE_FILES),
      round(2, "formal", FIVE_FILES),
      round(3, "formal", FIVE_FILES),
    ]);
    const twoMisses = feed("formality", [
      ...active.rounds.map((r) => round(r.round, r.value, r.supportSampleIds)),
      round(4, "casual", FIVE_FILES),
      round(5, "unknown", []),
    ]);
    expect(twoMisses).toMatchObject({ status: "active", value: "formal" });
    expect(advanceStyleRule("formality", twoMisses, round(6, "casual", FIVE_FILES)).status).toBe(
      "retired",
    );

    // 删除样本后重算当前轮，支持文件只剩 4 个。
    const shrunk = advanceStyleRule("formality", active, round(3, "formal", ["a", "b", "c", "d"]), {
      replaceLatest: true,
    });
    expect(shrunk.status).toBe("retired");
    expect(shrunk.rounds).toHaveLength(3);
  });

  it("U-LC-3: keeps only the most recent rounds", () => {
    const rounds = Array.from({ length: 10 }, (_, index) => round(index + 1, "unknown", []));
    expect(feed("formality", rounds).rounds).toHaveLength(ROUND_HISTORY_LIMIT);
  });

  it("U-LC-4 and U-MG-4: observations come from stored per-sample features", () => {
    const samples = FIVE_FILES.map((id) =>
      sample(id, {
        stats: { cjkLatinSpacing: { value: 1, weight: 10 } },
        labels: { formality: "formal" },
      }),
    );
    const observations = observeSamples(samples, 1);
    expect(observations.cjkLatinSpacing).toMatchObject({
      value: "spaced",
      supportSampleIds: FIVE_FILES,
    });
    expect(observations.formality).toMatchObject({ value: "formal" });
    expect(observations.organization?.value).toBe("unknown");

    // 去掉一个样本后不调用模型，直接用剩余样本重新聚合。
    let rules = applyObservations([], observations);
    rules = applyObservations(rules, observeSamples(samples, 2));
    rules = applyObservations(rules, observeSamples(samples, 3));
    expect(rules.find((rule) => rule.dimension === "formality")?.status).toBe("active");
    const remaining = samples.slice(1);
    rules = applyObservations(rules, observeSamples(remaining, 3), { replaceLatest: true });
    expect(rules.find((rule) => rule.dimension === "formality")?.status).toBe("retired");

    // 不合格的样本不参与聚合。
    expect(
      observeSamples([sample("x", { eligible: false, labels: { formality: "casual" } })], 1)
        .formality?.value,
    ).toBe("unknown");
  });
});
