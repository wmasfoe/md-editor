/**
 * @file slm-protocol.ts
 * @description 端侧专属小模型 (SLM) 紧凑协议：定义 Task Control Tokens、风格画像与文档上下文前缀拼装、中英混排分流器与 Stop Tokens 配置。
 */

import type {
  AiContextSnapshot,
  AiDocumentContext,
  AiDocumentSnapshot,
  UserStyleProfile,
} from "./types.ts";

/** 文档全局/章节语义提炼控制符 (80~150 字) */
export const TASK_DISTILL = "<|task_distill|>";

/** 语法纠错控制符 (GEC 三态与多语种) */
export const TASK_GEC_MIXED = "<|task_gec_mixed|>"; // 中英文混排专项
export const TASK_GEC_ZH = "<|task_gec_zh|>";       // 纯中文语境
export const TASK_GEC_EN = "<|task_gec_en|>";       // 纯英文语境
export const TASK_GEC_JA = "<|task_gec_ja|>";       // 日文
export const TASK_GEC_KO = "<|task_gec_ko|>";       // 韩文
export const TASK_GEC_RU = "<|task_gec_ru|>";       // 俄文
export const TASK_GEC_FR = "<|task_gec_fr|>";       // 法文

/** 标点与排版规范控制符 (盘古之白/全半角) */
export const TASK_PUNC = "<|task_punc|>";

/** FIM 行内补全控制符 (Prefix / Suffix / Middle / End) */
export const FIM_PREFIX = "<|fim_prefix|>";
export const FIM_SUFFIX = "<|fim_suffix|>";
export const FIM_MIDDLE = "<|fim_middle|>";
export const FIM_END = "<|fim_end|>";

/** 格式硬保真控制符 (LaTeX / 表格 / Frontmatter) */
export const TASK_PRESERVE_FORMAT = "<|task_preserve_format|>";

export type { UserStyleProfile, AiDocumentContext };

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
 * 构造结构化的文档全局上下文前缀 (结构 B)
 * 包含 Title, Outline, Topic, Domain 等宏观信息，为小模型提供全局视野。
 */
export function buildDocumentContextPrefix(
  docContext?: AiDocumentContext,
  document?: AiDocumentSnapshot,
): string {
  const title = docContext?.title || document?.title;
  const outline = docContext?.outline;
  const topic = docContext?.topic;
  const domain = docContext?.domain;
  const tags = docContext?.tags;

  if (!title && (!outline || outline.length === 0) && !topic && !domain && (!tags || tags.length === 0)) {
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
 * 基于待审校文本与语言设置，动态进行三态精准 GEC Task Token 分流
 * - 同时包含汉字与英文字母 -> <|task_gec_mixed|>
 * - 仅包含汉字 -> <|task_gec_zh|>
 * - 仅包含英文字母 -> <|task_gec_en|>
 * - 其他语种配置 -> 映射到 ja/ko/ru/fr 等专用 token
 */
export function detectGecTaskToken(text: string, language?: string): string {
  if (language) {
    const lang = language.toLowerCase().trim();
    if (lang.startsWith("ja")) return TASK_GEC_JA;
    if (lang.startsWith("ko")) return TASK_GEC_KO;
    if (lang.startsWith("ru")) return TASK_GEC_RU;
    if (lang.startsWith("fr")) return TASK_GEC_FR;
    if (lang.startsWith("en") && !/[\u4e00-\u9fa5\u3400-\u4dbf]/.test(text)) {
      return TASK_GEC_EN;
    }
  }

  const hasZh = /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(text);
  const hasEn = /[a-zA-Z]/.test(text);

  if (hasZh && hasEn) {
    return TASK_GEC_MIXED;
  }
  if (hasZh) {
    return TASK_GEC_ZH;
  }
  if (hasEn) {
    return TASK_GEC_EN;
  }

  return TASK_GEC_ZH;
}

/**
 * 兼容原有语言解析入口
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
 * 构造发给端侧 SLM 的标准 ChatML Prompt (对齐 Qwen2.5 指令微调模板)
 */
export function buildSlmPrompt(
  context: AiContextSnapshot,
  intent: "continuation" | "editing" | "both" | "distill" = "both",
  options: {
    readonly profile?: UserStyleProfile;
    readonly language?: string;
    readonly isPunctuationOnly?: boolean;
    readonly documentContext?: AiDocumentContext;
    readonly previousSummary?: string;
  } = {},
): string {
  // 1. 文档语义提炼任务 (<|task_distill|>)
  if (intent === "distill") {
    const docContext = options.documentContext || context.documentContext;
    const title = docContext?.title || context.document?.title || "未命名文档";
    const outlineStr = docContext?.outline && docContext.outline.length > 0
      ? docContext.outline.join(" > ")
      : "无结构大纲";
    const targetContent = context.selectedText || context.before;

    if (options.previousSummary) {
      // 累进滚动融合模式 (Rolling Refine)
      const userContent = [
        TASK_DISTILL,
        "【文档全局大纲】",
        outlineStr,
        "",
        "【前文提炼要点】",
        options.previousSummary,
        "",
        "【当前新增章节内容】",
        targetContent,
        "",
        "请将当前章节融合进前文要点，输出更新后的全篇概要（80~150字）：",
      ].join("\n");

      return `<|im_start|>user\n${userContent}<|im_end|>\n<|im_start|>assistant\n`;
    }

    // 单次全篇直投模式 (Single-Pass)
    const userContent = [
      TASK_DISTILL,
      `【文档标题】${title}`,
      `【章节大纲】${outlineStr}`,
      "【正文内容】",
      targetContent,
    ].join("\n");

    return `<|im_start|>user\n${userContent}<|im_end|>\n<|im_start|>assistant\n`;
  }

  // 2. 组装通用的 System Prompt (注入 User Style Profile 与 Document Context)
  const systemSections: string[] = [];
  const styleProfile = buildUserStyleProfilePrefix(options.profile);
  if (styleProfile) {
    systemSections.push(styleProfile);
  }

  const effectiveDocContext = options.documentContext || context.documentContext;
  const docContextPrefix = buildDocumentContextPrefix(effectiveDocContext, context.document);
  if (docContextPrefix) {
    systemSections.push(docContextPrefix);
  }

  const systemBlock = systemSections.length > 0
    ? `<|im_start|>system\n${systemSections.join("\n\n")}<|im_end|>\n`
    : "";

  // 3. FIM 行内续写补全任务
  if (intent === "continuation") {
    const userBlock = `<|im_start|>user\n${FIM_PREFIX}${context.before}${FIM_SUFFIX}${context.after}${FIM_MIDDLE}<|im_end|>\n`;
    return `${systemBlock}${userBlock}<|im_start|>assistant\n`;
  }

  // 4. GEC 语法或标点纠错任务
  const targetText = context.selectedText || context.before;
  const taskToken = options.isPunctuationOnly
    ? TASK_PUNC
    : detectGecTaskToken(targetText, options.language || context.document?.language);

  const userBlock = `<|im_start|>user\n${taskToken}${targetText}<|im_end|>\n`;
  return `${systemBlock}${userBlock}<|im_start|>assistant\n`;
}

/**
 * 获取针对不同任务的推荐 Stop Tokens
 */
export function getSlmStopTokens(
  intent: "continuation" | "editing" | "both" | "distill",
  options: { readonly isGhostText?: boolean } = {},
): string[] {
  if (intent === "distill") {
    // 提炼任务允许多行要点输出，遇到 <|im_end|> 或 <|endoftext|> 结束
    return ["<|im_end|>", "<|endoftext|>"];
  }

  if (intent === "continuation") {
    if (options.isGhostText !== false) {
      // 行内极速单行 Ghost Text 遇换行立即截断
      return ["\n", FIM_END, "<|im_end|>", "<|endoftext|>"];
    }
    // 主动块级/段落续写
    return [FIM_END, "<|im_end|>", "<|endoftext|>"];
  }

  // GEC 语法或标点纠错任务
  return ["\n", "<|im_end|>", "<|endoftext|>", FIM_PREFIX];
}
