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
    const valueSupport: Record<string, string[]> = {};
    for (const { sample, stat } of withStat) {
      const value = classifySampleStat(dimension, stat);
      (valueSupport[value] ??= []).push(sample.id);
    }
    observations[dimension] = {
      round,
      value: result.value,
      ...(result.aggregate === undefined ? {} : { aggregate: result.aggregate }),
      supportSampleIds:
        result.value === STYLE_UNKNOWN_VALUE ? [] : (valueSupport[result.value] ?? []),
      valueSupport,
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
    const valueSupport: Record<string, string[]> = {};
    for (const { sample, label } of labelled) {
      (valueSupport[label] ??= []).push(sample.id);
    }
    observations[dimension] = {
      round,
      value,
      supportSampleIds: value === STYLE_UNKNOWN_VALUE ? [] : (valueSupport[value] ?? []),
      valueSupport,
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
    const support = active.flatMap(({ workspace, rule }) =>
      (rule.rounds.at(-1)?.supportSampleIds ?? []).map((id) => `${workspace.id}:${id}`),
    );
    observations[dimension] = {
      round,
      value: active[0]!.rule.value,
      // 全局层的证据以“工作区:样本”计，保证不同工作区的样本不会重名。
      supportSampleIds: support,
      // 全局层只会有这一个取值（一致性检查已通过），逐值证据与支持样本相同。
      valueSupport: { [active[0]!.rule.value]: support },
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

/**
 * 把编辑反馈并入一轮观察：
 * - 维度本轮证据不足（unknown）而编辑反馈足够时，以反馈取值作为本轮观察；
 * - 取值一致时，把反馈计入支持（以 `edit:<维度>:<序号>` 标识，不对应样本文件）；
 * - 取值冲突时不改变本轮观察，冲突由后续多轮学习自然消解。
 */
export function withEditFeedback(
  observations: StyleObservations,
  feedback: Partial<Record<StyleDimensionId, { readonly value: string; readonly count: number }>>,
  round: number,
): StyleObservations {
  const next: Partial<Record<StyleDimensionId, StyleObservationRound>> = { ...observations };
  for (const [dimension, summary] of Object.entries(feedback) as Array<
    [StyleDimensionId, { value: string; count: number }]
  >) {
    const support = Array.from(
      // 每条编辑特征按一个支持证据计。
      { length: summary.count },
      (_, index) => `edit:${dimension}:${index}`,
    );
    const current = next[dimension];
    if (!current || current.value === STYLE_UNKNOWN_VALUE) {
      next[dimension] = { round, value: summary.value, supportSampleIds: support };
    } else if (current.value === summary.value) {
      next[dimension] = { ...current, supportSampleIds: [...current.supportSampleIds, ...support] };
    }
  }
  return next;
}
