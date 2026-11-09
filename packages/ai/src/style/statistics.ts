/**
 * @file style/statistics.ts
 * @module @md-editor/ai/style
 * @description
 * 可直接统计的风格维度：单样本特征计算、跨样本加权聚合与取值判定。
 *
 * 阈值是首版初值，后续按评测结果调整；证据不足时一律返回 `unknown`，宁缺勿错。
 */

import { STYLE_UNKNOWN_VALUE, type StatDimensionId } from "./dimensions.ts";
import type { ExtractedProse } from "./extraction.ts";
import type { StyleSampleStat } from "./types.ts";

const CJK = String.raw`\p{Script=Han}`;
const LATIN_OR_DIGIT = "[A-Za-z0-9]";
const CJK_GLOBAL = new RegExp(CJK, "gu");
const HAS_CJK = new RegExp(CJK, "u");
/** CJK 与拉丁字母/数字相邻的边界（中间允许一个空格） */
const CJK_LATIN_BOUNDARY = new RegExp(
  `(?:${CJK}( ?)${LATIN_OR_DIGIT})|(?:${LATIN_OR_DIGIT}( ?)${CJK})`,
  "gu",
);
/** 紧跟在 CJK 字符后的标点 */
const PUNCTUATION_AFTER_CJK = new RegExp(`${CJK}([，。！？；：,.!?;:])`, "gu");
const FULLWIDTH_PUNCTUATION = new Set(["，", "。", "！", "？", "；", "："]);
/** 出现在中文句子里的英文术语（至少两个字母） */
const LATIN_TERM = /[A-Za-z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]/gu;

/** 统计维度的判定规则 */
interface StatRule {
  /** 聚合时需要的最少证据量（各样本 weight 之和） */
  readonly minWeight: number;
  readonly classify: (aggregate: number) => string;
}

const STAT_RULES: Readonly<Record<StatDimensionId, StatRule>> = {
  // 段落平均字符数
  paragraphLength: {
    minWeight: 20,
    classify: (value) => (value < 80 ? "short" : value > 200 ? "long" : "medium"),
  },
  // 句子平均字符数
  sentenceLength: {
    minWeight: 50,
    classify: (value) => (value < 20 ? "short" : value > 45 ? "long" : "medium"),
  },
  // 每千字标题数
  headingDensity: {
    minWeight: 3000,
    classify: (value) => (value < 1 ? "sparse" : value > 4 ? "dense" : "regular"),
  },
  // 列表文字占散文的比例
  listUsage: {
    minWeight: 3000,
    classify: (value) => (value < 0.05 ? "rare" : value > 0.25 ? "frequent" : "regular"),
  },
  // 每千字强调次数
  emphasisUsage: {
    minWeight: 3000,
    classify: (value) => (value < 0.5 ? "rare" : "regular"),
  },
  // 中英文边界中带空格的比例
  cjkLatinSpacing: {
    minWeight: 20,
    classify: (value) =>
      value >= 0.7 ? "spaced" : value <= 0.3 ? "unspaced" : STYLE_UNKNOWN_VALUE,
  },
  // 中文后标点为全角的比例
  cjkPunctuationWidth: {
    minWeight: 30,
    classify: (value) =>
      value >= 0.8 ? "fullwidth" : value <= 0.2 ? "halfwidth" : STYLE_UNKNOWN_VALUE,
  },
  // 每千个汉字中的英文术语数；“翻译为中文”无法可靠统计，只能由用户自定义
  termScript: {
    minWeight: 2000,
    classify: (value) => (value >= 3 ? "keep-english" : STYLE_UNKNOWN_VALUE),
  },
};

/** 计算单个样本的统计特征。证据为零的维度不输出 */
export function computeSampleStats(
  prose: ExtractedProse,
): Partial<Record<StatDimensionId, StyleSampleStat>> {
  const stats: Partial<Record<StatDimensionId, StyleSampleStat>> = {};
  const set = (dimension: StatDimensionId, value: number, weight: number) => {
    if (weight > 0 && Number.isFinite(value)) {
      stats[dimension] = { value, weight };
    }
  };

  const paragraphChars = prose.paragraphs.map((paragraph) => paragraph.length);
  set("paragraphLength", mean(paragraphChars), paragraphChars.length);
  const sentenceChars = prose.sentences.map((sentence) => sentence.length);
  set("sentenceLength", mean(sentenceChars), sentenceChars.length);

  const chars = prose.proseChars;
  set("headingDensity", (prose.headingCount * 1000) / Math.max(chars, 1), chars);
  const listChars = prose.listItems.reduce((total, item) => total + item.length, 0);
  set("listUsage", listChars / Math.max(chars, 1), chars);
  set("emphasisUsage", (prose.emphasisCount * 1000) / Math.max(chars, 1), chars);

  const text = [...prose.paragraphs, ...prose.listItems].join("\n");
  let boundaries = 0;
  let spacedBoundaries = 0;
  for (const match of text.matchAll(CJK_LATIN_BOUNDARY)) {
    boundaries += 1;
    if ((match[1] ?? match[2]) === " ") {
      spacedBoundaries += 1;
    }
  }
  set("cjkLatinSpacing", spacedBoundaries / Math.max(boundaries, 1), boundaries);

  let punctuation = 0;
  let fullwidth = 0;
  for (const match of text.matchAll(PUNCTUATION_AFTER_CJK)) {
    punctuation += 1;
    if (FULLWIDTH_PUNCTUATION.has(match[1] ?? "")) {
      fullwidth += 1;
    }
  }
  set("cjkPunctuationWidth", fullwidth / Math.max(punctuation, 1), punctuation);

  const cjkChars = text.match(CJK_GLOBAL)?.length ?? 0;
  let terms = 0;
  for (const sentence of prose.sentences) {
    if (HAS_CJK.test(sentence)) {
      terms += sentence.match(LATIN_TERM)?.length ?? 0;
    }
  }
  set("termScript", (terms * 1000) / Math.max(cjkChars, 1), cjkChars);

  return stats;
}

export interface StatAggregate {
  /** 加权平均值；没有证据时为 undefined（区别于测得的 0） */
  readonly aggregate: number | undefined;
  /** 判定取值；证据不足时为 unknown */
  readonly value: string;
  readonly totalWeight: number;
}

/** 按证据量加权聚合多个样本的同一维度 */
export function aggregateStat(
  dimension: StatDimensionId,
  samples: readonly StyleSampleStat[],
): StatAggregate {
  const totalWeight = samples.reduce((total, sample) => total + sample.weight, 0);
  if (totalWeight === 0) {
    // 没有任何证据时不伪造聚合值：调用方据此区分“测到 0”和“没测到”。
    return { aggregate: undefined, value: STYLE_UNKNOWN_VALUE, totalWeight };
  }
  const aggregate =
    samples.reduce((total, sample) => total + sample.value * sample.weight, 0) / totalWeight;
  const rule = STAT_RULES[dimension];
  return {
    aggregate,
    value: totalWeight < rule.minWeight ? STYLE_UNKNOWN_VALUE : rule.classify(aggregate),
    totalWeight,
  };
}

/** 单样本自身的判定（用于统计“有多少文件支持该取值”），不检查最小证据量 */
export function classifySampleStat(dimension: StatDimensionId, stat: StyleSampleStat): string {
  return STAT_RULES[dimension].classify(stat.value);
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

/** 按聚合值判定取值（统计维度用它代替“逐样本类别”判断证据是否仍存在） */
export function classifyAggregate(dimension: StatDimensionId, aggregate: number): string {
  return STAT_RULES[dimension].classify(aggregate);
}
