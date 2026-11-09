import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlindSheet,
  checkContinuationStructure,
  checkFactsPreserved,
  markdownStructure,
  scoreBlindChoices,
  seededRandom,
  writeEvaluationArtifacts,
} from "./lib.mjs";

const pairs = Array.from({ length: 10 }, (_, index) => ({
  id: `p${index}`,
  prompt: `第 ${index} 篇`,
  withProfile: `有画像 ${index}`,
  withoutProfile: `无画像 ${index}`,
}));

test("EV-1：同一种子的盲评表可复现，答案与表格一一对应", () => {
  const first = buildBlindSheet(pairs, 42);
  const second = buildBlindSheet(pairs, 42);
  assert.deepEqual(first, second);
  assert.notDeepEqual(buildBlindSheet(pairs, 7).answers, first.answers);
  for (const row of first.sheet) {
    const profileSide = first.answers[row.id];
    assert.match(row[profileSide], /^有画像/u);
    assert.match(row[profileSide === "A" ? "B" : "A"], /^无画像/u);
  }
  const sides = new Set(Object.values(first.answers));
  assert.equal(sides.size, 2, "10 篇里两侧都应出现");
});

test("EV-1：盲评计分只统计有偏好的选择", () => {
  const { answers } = buildBlindSheet(pairs.slice(0, 3), 1);
  const ids = Object.keys(answers);
  const choices = {
    [ids[0]]: answers[ids[0]],
    [ids[1]]: answers[ids[1]] === "A" ? "B" : "A",
    [ids[2]]: "same",
  };
  assert.deepEqual(scoreBlindChoices(answers, choices), {
    preferProfile: 1,
    preferBaseline: 1,
    same: 1,
    profileWinRate: 0.5,
    incomplete: false,
    unfilled: [],
    unknownIds: [],
  });
  const random = seededRandom(3);
  assert.ok(random() >= 0 && random() < 1);
});

test("EV-2：结构比对检出被改动的标题、列表和未闭合的代码围栏", () => {
  const original = "# 标题\n\n- 一\n- 二\n\n正文";
  assert.deepEqual(markdownStructure(original), ["h1", "li", "li"]);
  assert.equal(checkContinuationStructure(original, `${original}继续写。\n\n## 小节`).ok, true);
  assert.equal(checkContinuationStructure(original, "## 标题\n\n- 一\n- 二").ok, false);
  const broken = checkContinuationStructure(original, `${original}\n\n\`\`\`js\nconst a = 1;`);
  assert.equal(broken.fencesClosed, false);
  assert.equal(broken.ok, false);
});

test("EV-3：纠错改动数字或专有名词时被检出", () => {
  assert.equal(checkFactsPreserved("React 18 发布于 2022 年", "React 18 发布在 2022 年").ok, true);
  assert.equal(checkFactsPreserved("React 18 发布于 2022 年", "React 19 发布于 2022 年").ok, false);
  assert.equal(checkFactsPreserved("用 TypeScript 写", "用类型脚本写").ok, false);
  assert.equal(checkFactsPreserved("版本 1.5", "版本1.5").ok, true);
});

test("EV-4：盲评交付物齐全（表、答案、填写模板、报告）", async () => {
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const fs = await import("node:fs");

  const { sheet, answers } = buildBlindSheet(pairs.slice(0, 2), 9);
  const checks = sheet.map((row) => ({
    id: row.id,
    withProfile: { ok: true, prefixKept: true, fencesClosed: true },
    withoutProfile: { ok: true, prefixKept: true, fencesClosed: true },
  }));
  const dir = join(mkdtempSync(join(tmpdir(), "style-eval-")), "out");
  writeEvaluationArtifacts(
    {
      dir,
      sheet,
      answers,
      checks,
      meta: {
        generatedAt: "2026-11-09T00:00:00Z",
        endpoint: "http://127.0.0.1:8080/v1",
        model: "m",
      },
    },
    fs,
  );

  const blind = readFileSync(join(dir, "blind-sheet.md"), "utf8");
  const choices = JSON.parse(readFileSync(join(dir, "choices.json"), "utf8"));
  const report = readFileSync(join(dir, "REPORT.md"), "utf8");
  assert.deepEqual(Object.keys(choices).toSorted(), Object.keys(answers).toSorted());
  assert.match(blind, /## p0/);
  assert.match(report, /人工盲评/);
  assert.match(report, /--score/);
  assert.match(report, /\| p0 \| 通过 \| true \| true \|/);
});

test("EV-5：未填写或未知 id 的盲评不被静默计分", () => {
  const answers = { a: "A", b: "B" };
  const partial = scoreBlindChoices(answers, { a: "A" });
  assert.equal(partial.incomplete, true);
  assert.deepEqual(partial.unfilled, ["b"]);
  assert.equal(partial.preferProfile, 1);

  const typo = scoreBlindChoices(answers, { a: "A", b: "B", typo: "A" });
  assert.deepEqual(typo.unknownIds, ["typo"]);
  assert.equal(typo.incomplete, true);

  const bad = scoreBlindChoices(answers, { a: "A", b: "maybe" });
  assert.deepEqual(bad.unfilled, ["b"]);

  const complete = scoreBlindChoices(answers, { a: "A", b: "B" });
  assert.equal(complete.incomplete, false);
  assert.equal(complete.profileWinRate, 1);
});
