/**
 * @file app/harness-prompts.ts
 * @module @md-editor/ai
 * @description
 * App Harness 标准 Prompt 与 GBNF 语法构建器（对齐 RFC-004 v1.4.0 与多协议云端契约）。
 *
 * 设计要点：
 * 1. 本地 GEC（Lite Qwen 3 + Standard Gemma 4）：统一走标准 ChatML（System Prompt + 纯待检文本 User Prompt）+ GBNF 物理语法硬约束；
 * 2. 本地续写：
 *    - Lite (Qwen 3 0.6B)：走 `/completion` 原生 FIM（`<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>`），超低首字延迟；
 *    - Standard (Gemma 4 E2B)：走 `/v1/chat/completions` 标准 ChatML 续写协议；
 * 3. 本地/云端提炼（Distill）：统一走标准 ChatML 概要提炼指令；
 * 4. 云端多协议（OpenAI / Anthropic / Google）：统一构造协议无关的 `ModelContext`，由各 Adapter 映射至原生系统指令字段。
 */

import type { ModelContext } from "../domain/model-client.ts";
import { LITE_LOCAL_MODEL_ID } from "../domain/settings.ts";
import type {
  AiContextSnapshot,
  AiDocumentContext,
  AiDocumentSnapshot,
  UserStyleProfile,
} from "../domain/types.ts";
import { createAiPromptContext } from "./harness-guardrails.ts";

/** Qwen 系列原生 FIM 控制 Token（专用于 Lite 0.6B 极速 `/completion` 通道） */
export const FIM_PREFIX = "<|fim_prefix|>";
export const FIM_SUFFIX = "<|fim_suffix|>";
export const FIM_MIDDLE = "<|fim_middle|>";
export const FIM_END = "<|fim_end|>";

/**
 * RFC-004 标准紧凑四元组 JSON GBNF 语法围栏（rfc002_tuple.gbnf）。
 * 在 llama-server Logits 采样阶段物理屏蔽一切非元组 JSON 字符，杜绝闲聊与格式跑偏。
 */
export const RFC002_TUPLE_GBNF_GRAMMAR = [
  'root ::= ws "[" ws (tuple (ws "," ws tuple)*)? ws "]" ws',
  'tuple ::= "[" ws int ws "," ws int ws "," ws string ws "," ws string ws "]"',
  "int ::= [0-9]+",
  'string ::= "\\"" char* "\\""',
  'char ::= [^"\\\\\\x00-\\x1F] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F])',
  "ws ::= [ \\t\\n\\r]*",
].join("\n");

/** RFC-004 §2.1 本地 GEC 标准系统提示词 */
export const LOCAL_GEC_SYSTEM_PROMPT =
  '你是一个 Markdown 语法与错别字纠错器。找出文本中的错别字与修改建议，仅输出紧凑 JSON 格式 [[start, end, "原词", "建议词"]]。区间 [start, end] 严格以用户提供的待检文本首字符为 0 索引计数。如果文本完全无错，严格仅输出 []，禁止输出任何分析或多余文字。';

/** RFC-004 §2.2 本地 Standard 档位无缝续写系统提示词 */
export const LOCAL_CONTINUATION_SYSTEM_PROMPT =
  "你是一个无缝文本续写引擎。请根据用户提供的光标前文（以及可选的光标后文），直接输出接下来自然的续写内容。严禁输出任何解释、说明、前缀或 Markdown 引号包裹，直接输出纯续写正文。";

/** RFC-004 §2.3 文档高密度提炼系统提示词 */
export const DISTILL_SYSTEM_PROMPT =
  "你是一个高密度文档提炼助手。提取文章的核心主旨与关键专有名词，严格控制在 150 字以内。";

/** 云端多协议通用语法纠错系统提示词 */
export const CLOUD_GEC_SYSTEM_PROMPT = [
  "你是严谨的 Markdown 语法、拼写与标点纠错器。",
  "请仅针对用户提供的待检文本检查明显的错别字、语法语病、英文拼写错误或中英文标点错误。",
  "必须保持克制：遇到专有名词（如 LoRA、GGUF、TypeScript、Tauri 等）、代码片段或表达自然无误的句子，严禁强行润色或改写。",
  '严格只输出紧凑 JSON 数组：[[start, end, "原词", "建议词"]]，其中 [start, end] 以待检文本首字符为 0 索引计数。',
  "如果文本完全无错，严格仅输出 []，不要输出任何解释或 Markdown 代码围栏。",
].join("\n");

/** 云端多协议通用无缝续写系统提示词 */
export const CLOUD_CONTINUATION_SYSTEM_PROMPT = [
  "你是无缝 Markdown 写作续写引擎。",
  "请紧接【光标前文】末尾并自然衔接【光标后文】，直接输出光标处接下来最合理的续写正文。",
  "保持原文语言、语气与 Markdown 结构一致；不要重复【光标前文】已有的结尾词句，不要输出任何解释、客套话或外层引号围栏。",
].join("\n");

/** 默认用户写作风格画像 */
export const DEFAULT_USER_STYLE_PROFILE: UserStyleProfile = {
  language: "Mixed (zh-en)",
  punctuation: "Strict Pangu-spacing, Oxford-comma",
  preferredTerms: ["TypeScript", "Rust", "Markdown"],
  tone: "Technical Markdown",
};

/** 本地模型上下文裁剪窗口（控制 KV Cache 体积以保持毫秒级响应） */
const LOCAL_BEFORE_WINDOW_CHARS = 1_800;
const LOCAL_AFTER_WINDOW_CHARS = 600;

/**
 * 判断指定的本地模型是否采用 Lite (Qwen 3 0.6B) 原生 FIM 续写通道。
 */
export function isLiteLocalModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized === LITE_LOCAL_MODEL_ID ||
    normalized.includes("lite") ||
    normalized.includes("qwen3-0.6b")
  );
}

/**
 * 构造静态用户风格画像前缀（按字典序稳定排序以保护 KV Cache 命中率）。
 */
export function buildUserStyleProfilePrefix(
  profile: UserStyleProfile = DEFAULT_USER_STYLE_PROFILE,
): string {
  const lines: string[] = ["[User Style Profile]"];

  if (profile.language) {
    lines.push(`- Language: ${profile.language}`);
  }
  if (profile.punctuation) {
    lines.push(`- Punctuation: ${profile.punctuation}`);
  }
  if (profile.preferredTerms && profile.preferredTerms.length > 0) {
    const sortedTerms = profile.preferredTerms.toSorted();
    lines.push(`- Preferred: ${sortedTerms.join(", ")}`);
  }
  if (profile.tone) {
    lines.push(`- Tone: ${profile.tone}`);
  }

  return lines.join("\n");
}

/**
 * 构造宏观文档结构上下文前缀（Title / Outline / Topic / Domain / Tags）。
 */
export function buildDocumentContextPrefix(
  docContext?: AiDocumentContext,
  document?: AiDocumentSnapshot,
): string {
  const title = docContext?.title || document?.title;
  const outline = docContext?.outline;
  const topic = docContext?.topic;
  const domain = docContext?.domain;
  const tags =
    docContext?.tags && docContext.tags.length > 0 ? docContext.tags.toSorted() : undefined;

  if (
    !title &&
    (!outline || outline.length === 0) &&
    !topic &&
    !domain &&
    (!tags || tags.length === 0)
  ) {
    return "";
  }

  const lines: string[] = ["[Document Context]"];
  if (title) {
    lines.push(`- Title: ${title}`);
  }
  if (outline && outline.length > 0) {
    lines.push(`- Outline: ${outline.join(" > ")}`);
  }
  if (topic) {
    lines.push(`- Topic: ${topic}`);
  }
  if (domain) {
    lines.push(`- Domain: ${domain}`);
  }
  if (tags && tags.length > 0) {
    lines.push(`- Tags: ${tags.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * 构建端侧本地模型的 GEC 语法纠错 `ModelContext`（严格遵循 RFC-004 §2.1 & §2.2）。
 *
 * - User Prompt 直接发送纯 `targetText`，不添加任何前缀字符串，确保 `[start, end]` 0 索引绝对对齐；
 * - 挂载 `RFC002_TUPLE_GBNF_GRAMMAR` 物理语法围栏。
 */
export function buildLocalGecModelContext(
  targetText: string,
  options: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): ModelContext {
  return {
    instruction: LOCAL_GEC_SYSTEM_PROMPT,
    prompt: targetText,
    outputFormat: {
      kind: "gbnf-grammar",
      grammar: RFC002_TUPLE_GBNF_GRAMMAR,
    },
    temperature: 0.0,
    maxTokens: 128,
    task: "gec",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  };
}

/**
 * 构建端侧本地模型的续写 `ModelContext`（严格遵循 RFC-004 双档位分化协议）：
 * - Lite (Qwen 3 0.6B)：原生 `/completion` FIM 协议，首字延迟 15~25ms；
 * - Standard (Gemma 4 E2B)：标准 `/v1/chat/completions` ChatML 续写协议。
 */
export function buildLocalContinuationModelContext(
  snapshot: AiContextSnapshot,
  modelId: string,
  options: {
    readonly isGhostText?: boolean;
    readonly profile?: UserStyleProfile;
    readonly documentContext?: AiDocumentContext;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): ModelContext {
  const isGhostText = options.isGhostText !== false;
  const before =
    snapshot.before.length <= LOCAL_BEFORE_WINDOW_CHARS
      ? snapshot.before
      : snapshot.before.slice(-LOCAL_BEFORE_WINDOW_CHARS);
  const after =
    snapshot.after.length <= LOCAL_AFTER_WINDOW_CHARS
      ? snapshot.after
      : snapshot.after.slice(0, LOCAL_AFTER_WINDOW_CHARS);

  const maxTokens = isGhostText ? 64 : 128;

  if (isLiteLocalModel(modelId)) {
    const fimPrompt = `${FIM_PREFIX}${before}${FIM_SUFFIX}${after}${FIM_MIDDLE}`;
    const stopSequences = isGhostText
      ? ["\n", FIM_END, "<|im_end|>", "<|endoftext|>"]
      : [FIM_END, "<|im_end|>", "<|endoftext|>"];

    return {
      instruction: LOCAL_CONTINUATION_SYSTEM_PROMPT,
      prompt: fimPrompt,
      rawCompletion: {
        prompt: fimPrompt,
        cachePrompt: true,
      },
      temperature: 0.3,
      maxTokens,
      stopSequences,
      task: "completion",
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    };
  }

  // Standard (Gemma 4 E2B) 及后续通用基座：标准 ChatML 对话续写
  const docPrefix = buildDocumentContextPrefix(
    options.documentContext ?? snapshot.documentContext,
    snapshot.document,
  );
  const stylePrefix = options.profile ? buildUserStyleProfilePrefix(options.profile) : "";
  const instruction = [LOCAL_CONTINUATION_SYSTEM_PROMPT, stylePrefix, docPrefix]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = ["【光标前文】", before, "【光标后文】", after].join("\n");

  return {
    instruction,
    prompt: userPrompt,
    temperature: 0.3,
    maxTokens,
    stopSequences: isGhostText ? ["\n"] : [],
    task: "completion",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  };
}

/**
 * 构建云端多协议（OpenAI / Anthropic / Google）通用的 GEC 语法纠错 `ModelContext`。
 */
export function buildCloudGecModelContext(
  targetText: string,
  options: {
    readonly documentContext?: AiDocumentContext;
    readonly document?: AiDocumentSnapshot;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): ModelContext {
  const docPrefix = buildDocumentContextPrefix(options.documentContext, options.document);
  const instruction = docPrefix
    ? `${CLOUD_GEC_SYSTEM_PROMPT}\n\n${docPrefix}`
    : CLOUD_GEC_SYSTEM_PROMPT;

  return {
    instruction,
    prompt: targetText,
    temperature: 0.0,
    maxTokens: 256,
    task: "gec",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  };
}

/**
 * 构建云端多协议（OpenAI / Anthropic / Google）通用的续写 `ModelContext`。
 */
export function buildCloudContinuationModelContext(
  snapshot: AiContextSnapshot,
  options: {
    readonly isGhostText?: boolean;
    readonly profile?: UserStyleProfile;
    readonly documentContext?: AiDocumentContext;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): ModelContext {
  const isGhostText = options.isGhostText !== false;
  const sliced = createAiPromptContext(snapshot);
  const docPrefix = buildDocumentContextPrefix(
    options.documentContext ?? snapshot.documentContext,
    snapshot.document,
  );
  const stylePrefix = options.profile ? buildUserStyleProfilePrefix(options.profile) : "";

  const ghostRule = isGhostText
    ? "当前为行内幽灵续写模式：仅输出当前光标所在行的自然收尾短句（严格单行，不超过 60 字，禁止换行）。"
    : "当前为主动段落续写模式：可输出自然的后续句子或 Markdown 段落（控制在 200 字以内）。";

  const instruction = [CLOUD_CONTINUATION_SYSTEM_PROMPT, ghostRule, stylePrefix, docPrefix]
    .filter(Boolean)
    .join("\n\n");

  const prompt = ["【光标前文】", sliced.before, "", "【光标后文】", sliced.after].join("\n");

  return {
    instruction,
    prompt,
    temperature: 0.4,
    maxTokens: isGhostText ? 96 : 280,
    stopSequences: isGhostText ? ["\n"] : [],
    task: "completion",
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  };
}

/**
 * 构建文档宏观提炼（Distill）标准 ChatML `ModelContext`（支持 Single-Pass 与 Rolling-Refine）。
 */
export function buildDistillModelContext(input: {
  readonly title: string;
  readonly outline?: readonly string[];
  readonly content: string;
  readonly previousSummary?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): ModelContext {
  const outlineStr =
    input.outline && input.outline.length > 0 ? input.outline.join(" > ") : "无结构大纲";

  const prompt = input.previousSummary
    ? [
        `【文档标题】${input.title}`,
        `【章节大纲】${outlineStr}`,
        "【前文提炼要点】",
        input.previousSummary,
        "【当前新增章节内容】",
        input.content,
        "请将当前章节融合进前文要点，输出更新后的全篇概要（严格控制在 150 字以内）：",
      ].join("\n")
    : [
        `【文档标题】${input.title}`,
        `【章节大纲】${outlineStr}`,
        "【正文内容】",
        input.content,
      ].join("\n");

  return {
    instruction: DISTILL_SYSTEM_PROMPT,
    prompt,
    temperature: 0.2,
    maxTokens: 180,
    task: "distill",
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  };
}
