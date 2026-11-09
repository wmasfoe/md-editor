/**
 * @file style/merge.ts
 * @module @md-editor/ai/style
 * @description
 * 三层画像按维度合并：用户自定义 > 工作区（目录）画像 > 全局画像。
 *
 * 只有“已生效”的 AI 规则参与合并；草稿与已退场规则从不进入 prompt。
 */

import {
  CLASS_DIMENSION_IDS,
  STAT_DIMENSION_IDS,
  STYLE_DIMENSIONS,
  isKnownStyleValue,
  type StyleDimensionId,
} from "./dimensions.ts";
import {
  STYLE_DIMENSION_DISABLED,
  type CustomStyleRule,
  type MergedStyleProfile,
  type MergedStyleRule,
  type StyleLayer,
  type StyleRuleRecord,
} from "./types.ts";

export interface MergeStyleProfileInput {
  readonly global?: readonly StyleRuleRecord[];
  /** 当前文章所在工作区的规则；工作区未关联时传 undefined */
  readonly workspace?: readonly StyleRuleRecord[];
  readonly custom?: readonly CustomStyleRule[];
}

const DIMENSION_ORDER: readonly StyleDimensionId[] = [
  ...STAT_DIMENSION_IDS,
  ...CLASS_DIMENSION_IDS,
];

export function mergeStyleProfile(input: MergeStyleProfileInput): MergedStyleProfile {
  const chosen = new Map<StyleDimensionId, { layer: StyleLayer; value: string }>();
  const disabled = new Set<StyleDimensionId>();

  // 从低到高写入，后写入的层覆盖先写入的层。
  const applyAi = (layer: StyleLayer, rules: readonly StyleRuleRecord[] | undefined) => {
    for (const rule of rules ?? []) {
      if (rule.status === "active" && isKnownStyleValue(rule.dimension, rule.value)) {
        chosen.set(rule.dimension, { layer, value: rule.value });
      }
    }
  };
  applyAi("global", input.global);
  applyAi("workspace", input.workspace);

  const notes: MergedStyleRule[] = [];
  for (const rule of input.custom ?? []) {
    if (rule.kind === "note") {
      const text = rule.text.trim();
      if (text) {
        notes.push({ layer: "custom", text });
      }
      continue;
    }
    if (rule.value === STYLE_DIMENSION_DISABLED) {
      disabled.add(rule.dimension);
      chosen.delete(rule.dimension);
    } else if (isKnownStyleValue(rule.dimension, rule.value)) {
      disabled.delete(rule.dimension);
      chosen.set(rule.dimension, { layer: "custom", value: rule.value });
    }
  }

  const rules: MergedStyleRule[] = [];
  for (const dimension of DIMENSION_ORDER) {
    const entry = chosen.get(dimension);
    if (!entry || disabled.has(dimension)) {
      continue;
    }
    rules.push({
      layer: entry.layer,
      dimension,
      value: entry.value,
      text: STYLE_DIMENSIONS[dimension].templates[entry.value] ?? "",
    });
  }
  return { rules: [...rules, ...notes] };
}

/** 读取合并画像中某个维度的取值（纠错误报过滤与风格建议使用） */
export function mergedStyleValue(
  profile: MergedStyleProfile | undefined,
  dimension: StyleDimensionId,
): string | undefined {
  return profile?.rules.find((rule) => rule.dimension === dimension)?.value;
}
