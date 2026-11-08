import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlindSheet,
  checkContinuationStructure,
  checkFactsPreserved,
  markdownStructure,
  scoreBlindChoices,
  seededRandom,
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
