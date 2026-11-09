/**
 * @file style/edit-feedback.ts
 * @module @md-editor/ai/style
 * @description
 * 从“用户采纳 AI 建议后又修改了什么”中提取写作偏好的证据。
 *
 * 采纳时只在内存里保留 AI 原文；保存文档时与当前文章中最相似的句子对比，
 * 提取机械维度与句长的变化方向，作为特征落盘，原文与 AI 文本都不保存。
 */

import type { StyleDimensionId } from "./dimensions.ts";
import { splitStyleSentences } from "./sentences.ts";
import type { StyleEditFeatureRecord } from "./types.ts";

/** 编辑对的最低相似度，低于它视为两句话无关 */
export const EDIT_PAIR_MIN_SIMILARITY = 0.5;
/** 每个工作区最多保留的编辑特征数 */
export const MAX_EDIT_FEATURES = 200;

const CJK = String.raw`\p{Script=Han}`;
const SPACED_BOUNDARY = new RegExp(`${CJK} [A-Za-z0-9]|[A-Za-z0-9] ${CJK}`, "gu");
const TIGHT_BOUNDARY = new RegExp(`${CJK}[A-Za-z0-9]|[A-Za-z0-9]${CJK}`, "gu");
const FULLWIDTH_AFTER_CJK = new RegExp(`${CJK}[，。！？；：]`, "gu");
const HALFWIDTH_AFTER_CJK = new RegExp(`${CJK}[,.!?;:](?![0-9])`, "gu");
const LATIN_WORD = /[A-Za-z]{2,}/gu;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

function characterBigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

/** 基于字符二元组的 Dice 相似度（0~1） */
export function sentenceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = characterBigrams(a);
  const right = characterBigrams(b);
  let shared = 0;
  for (const [gram, n] of left) shared += Math.min(n, right.get(gram) ?? 0);
  const total = Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

/**
 * 比较 AI 原句与用户修改后的句子，返回体现用户偏好的维度取值。
 * 只输出能从这一对文本中明确看出的方向，没有变化的维度不输出。
 */
export function extractEditFeatures(
  aiText: string,
  userText: string,
): Array<{ readonly dimension: StyleDimensionId; readonly value: string }> {
  if (aiText === userText) return [];
  const features: Array<{ dimension: StyleDimensionId; value: string }> = [];

  const spacedDelta = count(userText, SPACED_BOUNDARY) - count(aiText, SPACED_BOUNDARY);
  const tightDelta = count(userText, TIGHT_BOUNDARY) - count(aiText, TIGHT_BOUNDARY);
  if (spacedDelta > 0 && tightDelta < 0)
    features.push({ dimension: "cjkLatinSpacing", value: "spaced" });
  if (spacedDelta < 0 && tightDelta > 0)
    features.push({ dimension: "cjkLatinSpacing", value: "unspaced" });

  const fullDelta = count(userText, FULLWIDTH_AFTER_CJK) - count(aiText, FULLWIDTH_AFTER_CJK);
  const halfDelta = count(userText, HALFWIDTH_AFTER_CJK) - count(aiText, HALFWIDTH_AFTER_CJK);
  if (fullDelta > 0 && halfDelta < 0)
    features.push({ dimension: "cjkPunctuationWidth", value: "fullwidth" });
  if (fullDelta < 0 && halfDelta > 0)
    features.push({ dimension: "cjkPunctuationWidth", value: "halfwidth" });

  // AI 写成中文、用户改回英文术语。
  if (count(userText, LATIN_WORD) > count(aiText, LATIN_WORD)) {
    features.push({ dimension: "termScript", value: "keep-english" });
  }

  // 句子明显变短或变长（按字符数，阈值 30%）。
  if (userText.length <= aiText.length * 0.7)
    features.push({ dimension: "sentenceLength", value: "short" });
  if (userText.length >= aiText.length * 1.3)
    features.push({ dimension: "sentenceLength", value: "long" });

  return features;
}

/**
 * 为每句采纳的 AI 文本在当前文章中找到最相似的句子，提取编辑特征。
 * 句子未被修改或找不到相似句时不产生特征。
 */
export function collectEditFeatures(
  acceptedAiTexts: readonly string[],
  markdown: string,
  at: string,
): StyleEditFeatureRecord[] {
  const current = splitStyleSentences(markdown);
  const records: StyleEditFeatureRecord[] = [];
  for (const aiSentence of acceptedAiTexts.flatMap((text) => splitStyleSentences(text))) {
    if (current.includes(aiSentence)) continue;
    let best: { sentence: string; score: number } | undefined;
    for (const sentence of current) {
      const score = sentenceSimilarity(aiSentence, sentence);
      if (!best || score > best.score) best = { sentence, score };
    }
    if (!best || best.score < EDIT_PAIR_MIN_SIMILARITY) continue;
    for (const feature of extractEditFeatures(aiSentence, best.sentence)) {
      records.push({ at, ...feature });
    }
  }
  return records;
}

/** 追加特征并只保留最近的若干条 */
export function appendEditFeatures(
  existing: readonly StyleEditFeatureRecord[],
  added: readonly StyleEditFeatureRecord[],
): StyleEditFeatureRecord[] {
  return [...existing, ...added].slice(-MAX_EDIT_FEATURES);
}

/**
 * 统计自上一轮以来的编辑特征，作为维度的附加支持：
 * 返回每个维度出现最多的取值及次数，供汇总轮把它计入支持证据。
 */
export function summarizeEditFeatures(
  features: readonly StyleEditFeatureRecord[],
  since?: string,
): Partial<Record<StyleDimensionId, { readonly value: string; readonly count: number }>> {
  const recent = since ? features.filter((feature) => feature.at > since) : features;
  const counts = new Map<StyleDimensionId, Map<string, number>>();
  for (const feature of recent) {
    const values = counts.get(feature.dimension) ?? new Map<string, number>();
    values.set(feature.value, (values.get(feature.value) ?? 0) + 1);
    counts.set(feature.dimension, values);
  }
  const summary: Partial<Record<StyleDimensionId, { value: string; count: number }>> = {};
  for (const [dimension, values] of counts) {
    const [top, second] = [...values.entries()].toSorted((a, b) => b[1] - a[1]);
    if (top && (!second || second[1] < top[1]))
      summary[dimension] = { value: top[0], count: top[1] };
  }
  return summary;
}
