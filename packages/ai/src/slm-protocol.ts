/**
 * @file slm-protocol.ts
 * @description 端侧专属小模型 (SLM) 紧凑协议：定义 Task Control Tokens、风格画像前缀拼装与 Stop Tokens 配置。
 */

import type { AiContextSnapshot, UserStyleProfile } from "./types.ts";

/** 语法纠错控制符 (GEC 6 语种) */
export const TASK_GEC_ZH = "<|task_gec_zh|>";
export const TASK_GEC_EN = "<|task_gec_en|>";
export const TASK_GEC_JA = "<|task_gec_ja|>";
export const TASK_GEC_KO = "<|task_gec_ko|>";
export const TASK_GEC_RU = "<|task_gec_ru|>";
export const TASK_GEC_FR = "<|task_gec_fr|>";

/** 标点与排版规范控制符 (盘古之白/全半角) */
export const TASK_PUNC = "<|task_punc|>";

/** FIM 行内补全控制符 (Prefix / Suffix / Middle / End) */
export const FIM_PREFIX = "<|fim_prefix|>";
export const FIM_SUFFIX = "<|fim_suffix|>";
export const FIM_MIDDLE = "<|fim_middle|>";
export const FIM_END = "<|fim_end|>";

/** 格式硬保真控制符 (LaTeX / 表格 / Frontmatter) */
export const TASK_PRESERVE_FORMAT = "<|task_preserve_format|>";

export type { UserStyleProfile };

/** 默认前缀风格画像 */
export const DEFAULT_USER_STYLE_PROFILE: UserStyleProfile = {
  language: "Mixed (zh-en)",
  punctuation: "Strict Pangu-spacing, Oxford-comma",
  preferredTerms: ["TypeScript", "Rust", "Markdown"],
  tone: "Technical Markdown",
};

/**
 * 构造置顶的用户风格画像前缀 (结构 A)
 * 放置在 Prompt 最前端，以便 llama-server 跨任务永久复用 Prefix KV Cache。
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
    lines.push(`- Preferred: ${profile.preferredTerms.join(", ")}`);
  }
  if (profile.tone) {
    lines.push(`- Tone: ${profile.tone}`);
  }

  return lines.join("\n");
}

/**
 * 根据语言识别或指定对应的 GEC Task Token
 */
export function resolveGecTaskToken(language?: string): string {
  if (!language) return TASK_GEC_ZH;
  const lang = language.toLowerCase().trim();
  if (lang.startsWith("en")) return TASK_GEC_EN;
  if (lang.startsWith("ja")) return TASK_GEC_JA;
  if (lang.startsWith("ko")) return TASK_GEC_KO;
  if (lang.startsWith("ru")) return TASK_GEC_RU;
  if (lang.startsWith("fr")) return TASK_GEC_FR;
  return TASK_GEC_ZH;
}

/**
 * 构造发给端侧 SLM 的紧凑 Prompt (对齐 Qwen2.5 指令微调模板)
 */
export function buildSlmPrompt(
  context: AiContextSnapshot,
  intent: "continuation" | "editing" | "both" = "both",
  options: {
    readonly profile?: UserStyleProfile;
    readonly language?: string;
    readonly isPunctuationOnly?: boolean;
  } = {},
): string {
  if (intent === "continuation") {
    // FIM 补全任务：[User Style Profile]...\n\n<|fim_prefix|>${before}<|fim_suffix|>${after}<|fim_middle|>
    const prefix = buildUserStyleProfilePrefix(options.profile);
    const fimContent = `${prefix}\n\n${FIM_PREFIX}${context.before}${FIM_SUFFIX}${context.after}${FIM_MIDDLE}`;
    return `<|im_start|>user\n${fimContent}<|im_end|>\n<|im_start|>assistant\n`;
  }

  // 纠错或排版任务：<|task_gec_zh|>${targetText}
  const targetText = context.selectedText || context.before;
  const taskToken = options.isPunctuationOnly
    ? TASK_PUNC
    : resolveGecTaskToken(options.language || context.document?.language);

  return `<|im_start|>user\n${taskToken}${targetText}<|im_end|>\n<|im_start|>assistant\n`;
}

/**
 * 获取针对不同任务的推荐 Stop Tokens
 */
export function getSlmStopTokens(
  intent: "continuation" | "editing" | "both",
  options: { readonly isGhostText?: boolean } = {},
): string[] {
  if (intent === "continuation") {
    if (options.isGhostText !== false) {
      // 行内极速单行 Ghost Text
      return ["\n", FIM_END, "<|im_end|>", "<|endoftext|>"];
    }
    // 主动块级/段落续写
    return [FIM_END, "<|im_end|>", "<|endoftext|>"];
  }

  // GEC 语法或标点纠错任务
  return ["\n", "<|im_end|>", "<|endoftext|>", FIM_PREFIX];
}
