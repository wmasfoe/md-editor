import { describe, expect, it } from "vitest";

import {
  ROUND_HISTORY_LIMIT,
  advanceStyleRule,
  type StyleRuleRecord,
} from "../../src/style/index.ts";
import { applyObservations, observeSamples } from "../../src/style/engine-entry.ts";
import { FIVE_FILES, round, sample } from "./fixtures.ts";

/** 本轮胜出 casual、但 formal 自己仍有 5 个文件支持 */
function contestedRound(n: number) {
  return {
    round: n,
    value: "casual",
    supportSampleIds: FIVE_FILES,
    valueSupport: { casual: FIVE_FILES, formal: FIVE_FILES },
  };
}

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
    // 本轮胜出取值换成 casual，但 formal 自己仍有 5 个文件支持：保持生效。
    const contested = advanceStyleRule("formality", active, contestedRound(4));
    expect(contested).toMatchObject({ status: "active", value: "formal" });

    // 连续三轮 formal 都不再胜出：退场。
    const two = advanceStyleRule("formality", contested, contestedRound(5));
    expect(two.status).toBe("active");
    expect(advanceStyleRule("formality", two, contestedRound(6)).status).toBe("retired");

    // 删除样本后重算当前轮，支持文件只剩 4 个。
    const shrunk = advanceStyleRule("formality", active, round(3, "formal", ["a", "b", "c", "d"]), {
      replaceLatest: true,
    });
    expect(shrunk.status).toBe("retired");
    // 退场时丢弃旧轮次，重新积累才能再次生效。
    expect(shrunk.rounds).toHaveLength(1);
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

describe("retire when the supporting evidence disappears", () => {
  it("retires an active rule as soon as no sample supports it", () => {
    const active = feed("formality", [
      round(1, "formal", FIVE_FILES),
      round(2, "formal", FIVE_FILES),
      round(3, "formal", FIVE_FILES),
    ]);
    expect(active.status).toBe("active");
    // 支持它的文件全部被排除：本轮取值 unknown 且没有任何支持样本。
    const retired = advanceStyleRule("formality", active, round(4, "unknown", []), {
      replaceLatest: true,
    });
    expect(retired.status).toBe("retired");
  });

  it("keeps the rule when a competing value still has evidence", () => {
    const active = feed("formality", [
      round(1, "formal", FIVE_FILES),
      round(2, "formal", FIVE_FILES),
      round(3, "formal", FIVE_FILES),
    ]);
    // formal 自己仍有 5 个文件支持（只是本轮胜出的是 casual）：保持生效。
    const stillActive = advanceStyleRule("formality", active, contestedRound(4));
    expect(stillActive.status).toBe("active");
  });
});

describe("retire when the rule's own value loses support", () => {
  it("retires even when a competing value wins the round", () => {
    const active = feed("formality", [
      round(1, "formal", FIVE_FILES),
      round(2, "formal", FIVE_FILES),
      round(3, "formal", FIVE_FILES),
    ]);
    // 支持 formal 的文件全被排除，本轮 casual 有 3 个文件支持。
    const competing = {
      round: 4,
      value: "casual",
      supportSampleIds: ["x", "y", "z"],
      valueSupport: { casual: ["x", "y", "z"], formal: [] },
    };
    expect(advanceStyleRule("formality", active, competing, { replaceLatest: true }).status).toBe(
      "retired",
    );
  });

  it("stays active while its own value still has five files", () => {
    const active = feed("formality", [
      round(1, "formal", FIVE_FILES),
      round(2, "formal", FIVE_FILES),
      round(3, "formal", FIVE_FILES),
    ]);
    const contested = {
      round: 4,
      value: "casual",
      supportSampleIds: ["x", "y", "z"],
      valueSupport: { casual: ["x", "y", "z"], formal: FIVE_FILES },
    };
    expect(advanceStyleRule("formality", active, contested).status).toBe("active");

    // 本轮只有 casual 有证据、formal 缺席（真实产出里缺席即无支持）：立即退场。
    const absent = {
      round: 4,
      value: "casual",
      supportSampleIds: ["x", "y", "z"],
      valueSupport: { casual: ["x", "y", "z"] },
    };
    expect(advanceStyleRule("formality", active, absent).status).toBe("retired");
  });
});
