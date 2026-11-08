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
  for (const [id, choice] of Object.entries(choices)) {
    if (choice === "same") same += 1;
    else if (choice === answers[id]) preferProfile += 1;
    else preferBaseline += 1;
  }
  const decided = preferProfile + preferBaseline;
  return {
    preferProfile,
    preferBaseline,
    same,
    profileWinRate: decided === 0 ? 0 : preferProfile / decided,
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
