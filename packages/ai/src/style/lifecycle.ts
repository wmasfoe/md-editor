/**
 * @file style/lifecycle.ts
 * @module @md-editor/ai/style
 * @description
 * 规则的草稿机制：观察中（draft）→ 已生效（active）→ 已退场（retired）。
 *
 * 一次偶然的写法不会直接影响 AI 输出：同一取值要在多轮汇总中反复出现、
 * 并且由足够多的不同文件支持，才会生效；生效后需要连续多轮不再支持才会退场。
 */

import { STYLE_DIMENSIONS, STYLE_UNKNOWN_VALUE, type StyleDimensionId } from "./dimensions.ts";
import type { StyleObservationRound, StyleRuleRecord } from "./types.ts";

/** 每条规则保留的最近轮数 */
export const ROUND_HISTORY_LIMIT = 6;
/** 生效所需的连续一致轮数 */
export const PROMOTE_ROUNDS = 3;
/** 生效所需的不同支持文件数 */
export const MIN_SUPPORT_FILES = 5;
/** 统计维度生效时，最近几轮聚合值允许的最大变异系数 */
export const MAX_STAT_VARIATION = 0.25;
/** 已生效规则连续多少轮不被支持后退场 */
export const RETIRE_ROUNDS = 3;

/**
 * 把一轮观察并入规则记录，并推进状态。
 *
 * `replaceLatest` 用于“删除或排除样本后重新聚合当前轮”：替换最后一轮而不是新增一轮。
 */
export function advanceStyleRule(
  dimension: StyleDimensionId,
  previous: StyleRuleRecord | undefined,
  observation: StyleObservationRound,
  options: { readonly replaceLatest?: boolean } = {},
): StyleRuleRecord {
  const history = previous?.rounds ?? [];
  const base = options.replaceLatest ? history.slice(0, -1) : history;
  const rounds = [...base, observation].slice(-ROUND_HISTORY_LIMIT);

  if (previous?.status === "active") {
    return {
      dimension,
      value: previous.value,
      status: shouldRetire(previous.value, rounds) ? "retired" : "active",
      rounds,
    };
  }

  const candidate = promotionCandidate(dimension, rounds);
  if (candidate) {
    return { dimension, value: candidate, status: "active", rounds };
  }
  const latestKnown = observation.value !== STYLE_UNKNOWN_VALUE ? observation.value : undefined;
  return {
    dimension,
    value: latestKnown ?? previous?.value ?? STYLE_UNKNOWN_VALUE,
    status: "draft",
    rounds,
  };
}

/** 最近 `PROMOTE_ROUNDS` 轮取值一致、支持文件足够且统计值稳定时返回该取值 */
function promotionCandidate(
  dimension: StyleDimensionId,
  rounds: readonly StyleObservationRound[],
): string | undefined {
  if (rounds.length < PROMOTE_ROUNDS) {
    return undefined;
  }
  const recent = rounds.slice(-PROMOTE_ROUNDS);
  const value = recent[0]?.value;
  if (!value || value === STYLE_UNKNOWN_VALUE || recent.some((round) => round.value !== value)) {
    return undefined;
  }
  const supportFiles = new Set(recent.flatMap((round) => round.supportSampleIds));
  if (supportFiles.size < MIN_SUPPORT_FILES) {
    return undefined;
  }
  if (STYLE_DIMENSIONS[dimension].kind === "stat") {
    const aggregates = recent.map((round) => round.aggregate);
    if (aggregates.some((aggregate) => aggregate === undefined)) {
      return undefined;
    }
    if (coefficientOfVariation(aggregates as number[]) > MAX_STAT_VARIATION) {
      return undefined;
    }
  }
  return value;
}

function shouldRetire(value: string, rounds: readonly StyleObservationRound[]): boolean {
  const latest = rounds.at(-1);
  // 样本被删除或排除后，当前轮的支持文件不足。
  if (latest?.value === value && latest.supportSampleIds.length < MIN_SUPPORT_FILES) {
    return true;
  }
  // 该取值自己在本轮已经没有任何证据（例如支持它的文件被排除、或被删除）：
  // 立即退场，不能让已生效规则继续把被排除的证据注入 prompt。
  const ownSupport = latest?.valueSupport?.[value];
  if (latest && latest.value !== value && ownSupport && ownSupport.length === 0) {
    return true;
  }
  if (
    latest &&
    latest.value !== value &&
    !latest.valueSupport &&
    latest.supportSampleIds.length === 0
  ) {
    return true;
  }
  if (rounds.length < RETIRE_ROUNDS) {
    return false;
  }
  return rounds.slice(-RETIRE_ROUNDS).every((round) => round.value !== value);
}

export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (mean === 0) {
    return values.every((value) => value === 0) ? 0 : Number.POSITIVE_INFINITY;
  }
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}
