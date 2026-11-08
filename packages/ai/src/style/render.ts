/**
 * @file style/render.ts
 * @module @md-editor/ai/style
 * @description
 * 把合并画像渲染为注入 prompt 的前缀。
 *
 * 前缀只包含规则文字，不包含路径、hash、样本或规则 id，保证“所见即所发”。
 * 本地上下文较小，前缀有长度预算，超出时按“自定义优先、维度权重高优先”截断。
 */

import { STYLE_DIMENSIONS, type StyleDimensionId } from "./dimensions.ts";
import type { MergedStyleProfile, MergedStyleRule, StyleLayer } from "./types.ts";

/** 前缀预算（估算 token 数） */
export const STYLE_PREFIX_TOKEN_BUDGET = 200;

/** 优先级契约：当前文章与本次指令优先于画像 */
export const STYLE_PRIORITY_CONTRACT =
  "以下是用户的写作偏好，优先级低于当前文章已有的语言、语气与格式，以及用户本次明确指令；冲突时以后者为准。";

/** 纠错宽容版的说明：这些写法是用户习惯，不要当作错误 */
export const STYLE_TOLERANCE_CONTRACT = "以下写法是用户的书写习惯，不视为错误，不要据此修改：";

/** 纠错宽容版只包含书写规则明确的维度 */
const TOLERANCE_DIMENSIONS: ReadonlySet<StyleDimensionId> = new Set(
  Object.values(STYLE_DIMENSIONS)
    .filter((descriptor) => descriptor.mechanical)
    .map((descriptor) => descriptor.id),
);

const LAYER_PRIORITY: Readonly<Record<StyleLayer, number>> = {
  custom: 3,
  workspace: 2,
  global: 1,
};

/** 估算 token：CJK 字符按 1 个计，其余按 4 个字符 1 个计 */
export function estimateStyleTokens(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/** 续写等生成任务使用的画像前缀；画像为空时返回空串 */
export function renderStylePrefix(
  profile: MergedStyleProfile | undefined,
  budget = STYLE_PREFIX_TOKEN_BUDGET,
): string {
  return renderWithin(STYLE_PRIORITY_CONTRACT, profile?.rules ?? [], budget);
}

/** 纠错使用的宽容版前缀，只列出不应被判为错误的书写习惯 */
export function renderStyleTolerancePrefix(
  profile: MergedStyleProfile | undefined,
  budget = STYLE_PREFIX_TOKEN_BUDGET,
): string {
  const rules = (profile?.rules ?? []).filter(
    (rule) => rule.dimension !== undefined && TOLERANCE_DIMENSIONS.has(rule.dimension),
  );
  return renderWithin(STYLE_TOLERANCE_CONTRACT, rules, budget);
}

function renderWithin(header: string, rules: readonly MergedStyleRule[], budget: number): string {
  if (rules.length === 0) {
    return "";
  }
  // 按优先级挑选能放进预算的规则，再恢复原有顺序输出，保证前缀稳定。
  const ranked = rules
    .map((rule, index) => ({ rule, index }))
    .toSorted((a, b) => priority(b.rule) - priority(a.rule) || a.index - b.index);
  let used = estimateStyleTokens(header) + 4;
  const kept = new Set<number>();
  for (const { rule, index } of ranked) {
    const cost = estimateStyleTokens(rule.text) + 2;
    if (used + cost > budget) {
      continue;
    }
    used += cost;
    kept.add(index);
  }
  if (kept.size === 0) {
    return "";
  }
  const lines = rules.filter((_, index) => kept.has(index)).map((rule) => `- ${rule.text}`);
  return ["[写作偏好]", header, ...lines].join("\n");
}

function priority(rule: MergedStyleRule): number {
  const weight = rule.dimension ? STYLE_DIMENSIONS[rule.dimension].weight : 10;
  return LAYER_PRIORITY[rule.layer] * 100 + weight;
}
