/**
 * 风格学习验收评测的纯函数（node:test 覆盖，见 lib.test.mjs）。
 *
 * - 盲评表：同一篇留出文章的“有画像 / 无画像”两版续写按固定种子打乱为 A/B，
 *   答案另存，评测人只看盲评表；
 * - 结构检查：续写不能破坏 Markdown 结构（标题、列表、代码围栏、表格的数量与顺序）；
 * - 事实检查：纠错不能改动数字与专有名词（拉丁字母词）。
 */

/** 固定种子的伪随机数（mulberry32），保证同一种子打乱结果可复现 */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成盲评表与答案。`pairs`：[{ id, prompt, withProfile, withoutProfile }]。
 */
export function buildBlindSheet(pairs, seed) {
  const random = seededRandom(seed);
  const sheet = [];
  const answers = {};
  for (const pair of pairs) {
    const profileFirst = random() < 0.5;
    sheet.push({
      id: pair.id,
      prompt: pair.prompt,
      A: profileFirst ? pair.withProfile : pair.withoutProfile,
      B: profileFirst ? pair.withoutProfile : pair.withProfile,
    });
    answers[pair.id] = profileFirst ? "A" : "B";
  }
  return { sheet, answers };
}

/** 汇总盲评结果：`choices` 为 { [id]: "A" | "B" | "same" } */
export function scoreBlindChoices(answers, choices) {
  let preferProfile = 0;
  let preferBaseline = 0;
  let same = 0;
  // 未填写（仍为模板默认值 "same"）与未知 id 都不能静默计分，否则报告会偏向基线。
  const unfilled = [];
  const unknownIds = [];
  for (const id of Object.keys(answers)) {
    const choice = choices[id];
    if (choice === undefined) unfilled.push(id);
  }
  for (const [id, choice] of Object.entries(choices)) {
    if (!(id in answers)) {
      unknownIds.push(id);
      continue;
    }
    if (choice === "same") same += 1;
    else if (choice === answers[id]) preferProfile += 1;
    else if (choice === (answers[id] === "A" ? "B" : "A")) preferBaseline += 1;
    else unfilled.push(id);
  }
  const decided = preferProfile + preferBaseline;
  return {
    preferProfile,
    preferBaseline,
    same,
    profileWinRate: decided === 0 ? 0 : preferProfile / decided,
    incomplete: unfilled.length > 0 || unknownIds.length > 0,
    unfilled,
    unknownIds,
  };
}

/** 提取 Markdown 结构签名（忽略围栏内内容） */
export function markdownStructure(markdown) {
  const signature = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      signature.push("fence");
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})\s/u.exec(line);
    if (heading) signature.push(`h${heading[1].length}`);
    else if (/^\s*([-*+]|\d+\.)\s/u.test(line)) signature.push("li");
    else if (/^\s*\|.*\|\s*$/u.test(line)) signature.push("tr");
    else if (/^\s*>/u.test(line)) signature.push("quote");
  }
  return signature;
}

/**
 * 续写后的结构必须以原文结构为前缀（续写只能追加，不能改动已有结构），
 * 且所有代码围栏成对闭合。
 */
export function checkContinuationStructure(original, continued) {
  const before = markdownStructure(original);
  const after = markdownStructure(continued);
  const prefixKept = before.every((item, index) => after[index] === item);
  const fencesClosed = after.filter((item) => item === "fence").length % 2 === 0;
  return { ok: prefixKept && fencesClosed, prefixKept, fencesClosed };
}

/** 文本中的数字与拉丁字母专有名词（多重集合） */
export function factTokens(text) {
  return (text.match(/\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]/gu) ?? []).toSorted();
}

/** 纠错前后数字与专有名词必须一致 */
export function checkFactsPreserved(before, after) {
  const a = factTokens(before);
  const b = factTokens(after);
  const missing = a.filter((token, index) => b[index] !== token);
  return { ok: a.length === b.length && missing.length === 0, before: a, after: b };
}

/**
 * 写出盲评交付物：盲评表、答案、评测人填写模板与报告。
 * 纯文件写入，便于测试；`sheet`/`answers` 来自 `buildBlindSheet`。
 */
export function writeEvaluationArtifacts({ dir, sheet, answers, checks, meta }, fs) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    `${dir}/blind-sheet.md`,
    sheet
      .map(
        (row) =>
          `## ${row.id}\n\n> …${row.prompt}\n\n**A**\n\n${row.A}\n\n**B**\n\n${row.B}\n\n选择：A / B / same\n`,
      )
      .join("\n---\n\n"),
  );
  fs.writeFileSync(`${dir}/answers.json`, `${JSON.stringify(answers, null, 2)}\n`);
  fs.writeFileSync(`${dir}/checks.json`, `${JSON.stringify(checks, null, 2)}\n`);
  fs.writeFileSync(
    `${dir}/choices.json`,
    `${JSON.stringify(Object.fromEntries(sheet.map((row) => [row.id, "same"])), null, 2)}\n`,
  );
  fs.writeFileSync(
    `${dir}/REPORT.md`,
    [
      "# 风格学习验收评测报告",
      "",
      `生成时间：${meta.generatedAt}`,
      `端点：${meta.endpoint}（模型 ${meta.model}）`,
      `留出文章：${sheet.length} 篇`,
      "",
      "## 自动检查：续写是否破坏 Markdown 结构",
      "",
      "| 文章 | 结论 | 有画像 | 无画像 |",
      "| --- | --- | --- | --- |",
      ...checks.map(
        (entry) =>
          `| ${entry.id} | ${entry.withProfile.ok && entry.withoutProfile.ok ? "通过" : "需检查"} | ${entry.withProfile.ok} | ${entry.withoutProfile.ok} |`,
      ),
      "",
      "## 人工盲评（待用户完成）",
      "",
      "1. 打开 `blind-sheet.md`，逐篇比较 A / B，把选择填进 `choices.json`（`A` / `B` / `same`）。",
      `2. 运行 \`node scripts/style-eval/run.mjs --out ${dir} --score ${dir}/choices.json\`。`,
      "3. 判定标准：有画像版本被选中过半，且采纳后修改量下降，才扩大自动化范围。",
      "4. `answers.json` 是答案，评测期间不要打开。",
      "",
    ].join("\n"),
  );
}
