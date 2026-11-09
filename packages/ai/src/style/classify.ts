/**
 * @file style/classify.ts
 * @module @md-editor/ai/style
 * @description
 * 分类维度（正式程度、组织方式、举例习惯）的本地模型请求构造与结果解析。
 *
 * 模型只能在枚举中选择（GBNF 约束），提示词只包含散文片段，不包含文件路径等元数据。
 */

import { STANDARD_LOCAL_MODEL_ID } from "../domain/settings.ts";
import type { LocalInferenceRequest } from "../domain/model-client.ts";
import {
  CLASS_DIMENSION_IDS,
  STYLE_UNKNOWN_VALUE,
  styleDimensionValues,
  type ClassDimensionId,
} from "./dimensions.ts";

/** 单个分类请求的散文字符上限（约 2500 token 以内，留出系统提示与输出空间） */
export const STYLE_CLASSIFY_CHUNK_CHARS = 2000;
/** 每个样本最多分类的块数，控制长文的推理开销 */
export const MAX_CHUNKS_PER_SAMPLE = 3;

export type StyleClassLabels = Partial<Record<ClassDimensionId, string>>;

const CLASSIFY_SYSTEM_PROMPT = [
  "你是写作风格分析器。只判断下面这段文字的写作方式，不关心它讲了什么内容、人物、项目或事实。",
  "formality：formal（正式书面）/ neutral（平实）/ casual（口语化）。",
  "organization：conclusion-first（先结论后原因）/ context-first（先背景后结论）/ mixed。",
  "exampleUsage：frequent（解释时常举例）/ rare（很少举例）。",
  "证据不足的项输出 unknown。严格按 formality=…;organization=…;exampleUsage=… 输出，不要输出其他内容。",
].join("\n");

/** 只允许枚举取值的 GBNF 语法 */
export const STYLE_CLASSIFY_GBNF = buildClassifyGrammar();

function buildClassifyGrammar(): string {
  const fields = CLASS_DIMENSION_IDS.map((dimension) => `"${dimension}=" ${dimension}-value`);
  const values = CLASS_DIMENSION_IDS.map((dimension) => {
    const options = [...styleDimensionValues(dimension), STYLE_UNKNOWN_VALUE]
      .map((value) => `"${value}"`)
      .join(" | ");
    return `${dimension}-value ::= ${options}`;
  });
  return [`root ::= ${fields.join(' ";" ')}`, ...values].join("\n");
}

/** 把一篇文章的段落切成不超过上限的块，最多返回 `MAX_CHUNKS_PER_SAMPLE` 块 */
export function chunkStyleProse(paragraphs: readonly string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const piece = paragraph.slice(0, STYLE_CLASSIFY_CHUNK_CHARS);
    if (current && current.length + piece.length + 2 > STYLE_CLASSIFY_CHUNK_CHARS) {
      chunks.push(current);
      current = "";
      if (chunks.length >= MAX_CHUNKS_PER_SAMPLE) {
        return chunks;
      }
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current && chunks.length < MAX_CHUNKS_PER_SAMPLE) {
    chunks.push(current);
  }
  return chunks;
}

/** 构造一次分类请求。固定使用本地 Standard 模型与 `style-analysis` 任务 */
export function buildStyleClassifyRequest(chunk: string): LocalInferenceRequest {
  return {
    modelId: STANDARD_LOCAL_MODEL_ID,
    task: "style-analysis",
    messages: [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      { role: "user", content: chunk },
    ],
    grammar: STYLE_CLASSIFY_GBNF,
    maxTokens: 48,
    temperature: 0,
    disableThinking: true,
    cachePrompt: false,
  };
}

/** 解析模型输出；任何不在枚举内的取值都视为 unknown */
export function parseStyleClassifyOutput(output: string): StyleClassLabels {
  const labels: StyleClassLabels = {};
  for (const dimension of CLASS_DIMENSION_IDS) {
    const match = new RegExp(`${dimension}=([a-z-]+)`, "u").exec(output);
    const value = match?.[1];
    labels[dimension] =
      value && styleDimensionValues(dimension).includes(value) ? value : STYLE_UNKNOWN_VALUE;
  }
  return labels;
}

/** 多块投票：取出现最多的已知取值，平票或全部未知时为 unknown */
export function voteStyleLabels(chunkLabels: readonly StyleClassLabels[]): StyleClassLabels {
  const labels: StyleClassLabels = {};
  for (const dimension of CLASS_DIMENSION_IDS) {
    labels[dimension] = majority(
      chunkLabels.map((chunk) => chunk[dimension] ?? STYLE_UNKNOWN_VALUE),
      0.5,
    );
  }
  return labels;
}

/**
 * 返回出现次数严格最多、且占已知取值比例超过 `minShare` 的取值；否则为 unknown。
 */
export function majority(values: readonly string[], minShare: number): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== STYLE_UNKNOWN_VALUE) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const known = [...counts.values()].reduce((total, count) => total + count, 0);
  const ranked = [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || known === 0 || (second && second[1] === top[1]) || top[1] / known <= minShare) {
    return STYLE_UNKNOWN_VALUE;
  }
  return top[0];
}
