/**
 * @file style/aggregate.ts
 * @module @md-editor/ai/style
 * @description
 * 从样本的统计值与分类标签聚合出一轮观察，并推进各层规则。
 *
 * 聚合只依赖每个样本保存的派生特征，因此删除或排除样本后可以不调用模型直接重算。
 */

import { majority } from "./classify.ts";
import {
  CLASS_DIMENSION_IDS,
  STAT_DIMENSION_IDS,
  STYLE_UNKNOWN_VALUE,
  type StyleDimensionId,
} from "./dimensions.ts";
import { advanceStyleRule } from "./lifecycle.ts";
import { aggregateStat, classifySampleStat } from "./statistics.ts";
import type {
  StyleObservationRound,
  StyleRuleRecord,
  StyleSampleRecord,
  StyleSampleStat,
  WorkspaceStyleProfileRecord,
} from "./types.ts";

/** 分类维度的多数取值至少要占已知标签的比例 */
const CLASS_MAJORITY_SHARE = 0.5;

export type StyleObservations = Readonly<Partial<Record<StyleDimensionId, StyleObservationRound>>>;

/** 用一组样本计算各维度在某一轮的观察 */
export function observeSamples(
  samples: readonly StyleSampleRecord[],
  round: number,
): StyleObservations {
  const eligible = samples.filter((sample) => sample.eligible);
  const observations: Partial<Record<StyleDimensionId, StyleObservationRound>> = {};

  for (const dimension of STAT_DIMENSION_IDS) {
    const withStat = eligible.flatMap((sample) => {
      const stat = sample.stats[dimension];
      return stat ? [{ sample, stat }] : [];
    });
    const result = aggregateStat(
      dimension,
      withStat.map(({ stat }) => stat as StyleSampleStat),
    );
    observations[dimension] = {
      round,
      value: result.value,
      aggregate: result.aggregate,
      supportSampleIds:
        result.value === STYLE_UNKNOWN_VALUE
          ? []
          : withStat
              .filter(({ stat }) => classifySampleStat(dimension, stat) === result.value)
              .map(({ sample }) => sample.id),
    };
  }

  for (const dimension of CLASS_DIMENSION_IDS) {
    const labelled = eligible.flatMap((sample) => {
      const label = sample.labels[dimension];
      return label ? [{ sample, label }] : [];
    });
    const value = majority(
      labelled.map(({ label }) => label),
      CLASS_MAJORITY_SHARE,
    );
    observations[dimension] = {
      round,
      value,
      supportSampleIds:
        value === STYLE_UNKNOWN_VALUE
          ? []
          : labelled.filter(({ label }) => label === value).map(({ sample }) => sample.id),
    };
  }

  return observations;
}

/** 把一轮观察应用到规则列表上（维度顺序保持稳定） */
export function applyObservations(
  rules: readonly StyleRuleRecord[],
  observations: StyleObservations,
  options: { readonly replaceLatest?: boolean } = {},
): StyleRuleRecord[] {
  const byDimension = new Map(rules.map((rule) => [rule.dimension, rule]));
  const next: StyleRuleRecord[] = [];
  for (const dimension of [...STAT_DIMENSION_IDS, ...CLASS_DIMENSION_IDS]) {
    const observation = observations[dimension];
    const previous = byDimension.get(dimension);
    if (!observation) {
      if (previous) {
        next.push(previous);
      }
      continue;
    }
    // 替换当前轮时，从未观察过该维度的规则无需创建。
    if (options.replaceLatest && !previous) {
      continue;
    }
    next.push(advanceStyleRule(dimension, previous, observation, options));
  }
  return next;
}

/**
 * 由多个已链接工作区的生效规则推导全局观察：
 * 某维度至少在两个工作区生效且取值一致、没有工作区生效为其他取值时，才视为全局候选。
 */
export function observeGlobal(
  workspaces: readonly WorkspaceStyleProfileRecord[],
  round: number,
): StyleObservations {
  const linked = workspaces.filter((workspace) => workspace.linkState === "linked");
  const observations: Partial<Record<StyleDimensionId, StyleObservationRound>> = {};
  for (const dimension of [...STAT_DIMENSION_IDS, ...CLASS_DIMENSION_IDS]) {
    const active = linked.flatMap((workspace) => {
      const rule = workspace.rules.find(
        (candidate) => candidate.dimension === dimension && candidate.status === "active",
      );
      return rule ? [{ workspace, rule }] : [];
    });
    const values = new Set(active.map(({ rule }) => rule.value));
    const consistent = active.length >= 2 && values.size === 1;
    if (!consistent) {
      observations[dimension] = { round, value: STYLE_UNKNOWN_VALUE, supportSampleIds: [] };
      continue;
    }
    const latestAggregates = active
      .map(({ rule }) => rule.rounds.at(-1)?.aggregate)
      .filter((aggregate): aggregate is number => aggregate !== undefined);
    observations[dimension] = {
      round,
      value: active[0]!.rule.value,
      // 全局层的证据以“工作区:样本”计，保证不同工作区的样本不会重名。
      supportSampleIds: active.flatMap(({ workspace, rule }) =>
        (rule.rounds.at(-1)?.supportSampleIds ?? []).map((id) => `${workspace.id}:${id}`),
      ),
      ...(latestAggregates.length === active.length
        ? {
            aggregate:
              latestAggregates.reduce((total, value) => total + value, 0) / latestAggregates.length,
          }
        : {}),
    };
  }
  return observations;
}
