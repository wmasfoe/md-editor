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
import { classifyAggregate } from "./statistics.ts";
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
    if (shouldRetire(dimension, previous.value, rounds)) {
      // 退场时丢弃旧轮次：证据重新出现后必须重新积累 3 轮，避免在提示中反复进出。
      return { dimension, value: previous.value, status: "retired", rounds: [observation] };
    }
    return { dimension, value: previous.value, status: "active", rounds };
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

/**
 * 支持 id 是否来自真实样本文件。
 *
 * 编辑反馈以 `edit:<维度>:<序号>` 记录（全局层会加上 `工作区:` 前缀），
 * 它们只代表“用户改过 AI 文本的方向”，不能冒充独立文件。
 */
export function isRealSampleId(id: string): boolean {
  return !id.split(":").includes("edit");
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
  // 只统计真实样本文件；编辑反馈的 `edit:` 伪 id 不能凑够“支持文件 ≥ 5”。
  const supportFiles = new Set(
    recent.flatMap((round) => round.supportSampleIds.filter(isRealSampleId)),
  );
  if (supportFiles.size < MIN_SUPPORT_FILES) {
    return undefined;
  }
  if (STYLE_DIMENSIONS[dimension].kind === "stat") {
    const aggregates = recent.map((round) => round.aggregate);
    if (aggregates.some((aggregate) => aggregate === undefined)) {
      return undefined;
    }
    // 聚合值本身必须仍落在该取值区间，否则不能因为编辑反馈而晋升与之矛盾的取值。
    if (
      aggregates.some(
        (aggregate) =>
          classifyAggregate(dimension as Parameters<typeof classifyAggregate>[0], aggregate!) !==
          value,
      )
    ) {
      return undefined;
    }
    if (coefficientOfVariation(aggregates as number[]) > MAX_STAT_VARIATION) {
      return undefined;
    }
  }
  return value;
}

/**
 * 某个取值在本轮还剩多少证据。
 *
 * 统计维度用聚合值判定：聚合值仍然落在该取值区间时，证据依然存在，
 * 不能因为“逐样本类别”分散而误判为无证据。
 */
function ownSupportCount(
  dimension: StyleDimensionId,
  value: string,
  round: StyleObservationRound,
): number {
  // 逐样本证据：只数真实文件，编辑反馈不能单独支撑一条规则（与晋升口径一致）。
  const perSample = round.valueSupport?.[value]?.filter(isRealSampleId).length;
  if (perSample !== undefined) {
    return perSample;
  }
  // 全局层等没有逐样本证据的观察：用聚合值做“是否存在证据”的正向判断，
  // 但只在真的测到聚合值时才认（`aggregate === undefined` 表示没测到，按 0 计）。
  if (STYLE_DIMENSIONS[dimension].kind === "stat" && round.aggregate !== undefined) {
    return classifyAggregate(
      dimension as Parameters<typeof classifyAggregate>[0],
      round.aggregate,
    ) === value
      ? MIN_SUPPORT_FILES
      : 0;
  }
  return 0;
}

function shouldRetire(
  dimension: StyleDimensionId,
  value: string,
  rounds: readonly StyleObservationRound[],
): boolean {
  const latest = rounds.at(-1);
  if (!latest) {
    return false;
  }
  const own = ownSupportCount(dimension, value, latest);
  // 本轮胜出的就是该取值，但支持文件不足。
  if (latest.value === value && own < MIN_SUPPORT_FILES) {
    return true;
  }
  // 该取值自己本轮已无任何证据（例如支持它的文件被排除或删除）：立即退场。
  if (latest.value !== value && own === 0) {
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
