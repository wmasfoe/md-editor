/**
 * @file markdown-lint-i18n.ts
 * @description MarkdownLint 规则、建议与上下文详情的多语言国际化管理（支持 zh, zh-Hant, ja, en）。
 */

import {
  MARKDOWNLINT_ZH_RULES,
  MARKDOWNLINT_ZH_HANT_RULES,
  type LocalizedRuleInfo,
} from "./rules-zh.ts";
import { MARKDOWNLINT_JA_RULES } from "./rules-ja.ts";
import { MARKDOWNLINT_EN_RULES } from "./rules-en.ts";

export {
  MARKDOWNLINT_ZH_RULES,
  MARKDOWNLINT_ZH_HANT_RULES,
  MARKDOWNLINT_JA_RULES,
  MARKDOWNLINT_EN_RULES,
  type LocalizedRuleInfo,
};

export type LintLocale = "zh" | "zh-Hant" | "ja" | "en";

/**
 * 获取当前宿主环境的语言代码
 */
export function getActiveLintLocale(): LintLocale {
  if (typeof document === "undefined") return "zh";
  const lang = document.documentElement?.lang;
  if (!lang) return "zh";
  if (lang === "en" || lang.startsWith("en-")) return "en";
  if (lang === "ja" || lang.startsWith("ja-")) return "ja";
  if (lang === "zh-TW" || lang === "zh-HK" || lang === "zh-Hant" || lang.includes("Hant")) {
    return "zh-Hant";
  }
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

/**
 * 根据语言代码查询指定规则的本地化名称与描述
 */
export function getMarkdownLintRuleInfo(
  ruleCode: string,
  locale: LintLocale = getActiveLintLocale(),
): LocalizedRuleInfo | undefined {
  switch (locale) {
    case "ja":
      return MARKDOWNLINT_JA_RULES[ruleCode] ?? MARKDOWNLINT_EN_RULES[ruleCode];
    case "zh-Hant":
      return MARKDOWNLINT_ZH_HANT_RULES[ruleCode] ?? MARKDOWNLINT_ZH_RULES[ruleCode];
    case "en":
      return MARKDOWNLINT_EN_RULES[ruleCode];
    case "zh":
    default:
      return MARKDOWNLINT_ZH_RULES[ruleCode];
  }
}

/**
 * 获取“修复 / Fix / 修正”动作按钮的本地化标签
 */
export function getQuickFixActionLabel(locale: LintLocale = getActiveLintLocale()): string {
  switch (locale) {
    case "ja":
      return "修正";
    case "zh-Hant":
      return "修復";
    case "en":
      return "Fix";
    case "zh":
    default:
      return "修复";
  }
}

/**
 * 获取“关闭并清除规范检查”按钮提示的本地化标签
 */
export function getClosePanelTooltipLabel(locale: LintLocale = getActiveLintLocale()): string {
  switch (locale) {
    case "ja":
      return "規約チェックを閉じてクリア (Esc / ⌥⇧L)";
    case "zh-Hant":
      return "關閉並清除規範檢查 (Esc / ⌥⇧L)";
    case "en":
      return "Close and clear lint diagnostics (Esc / ⌥⇧L)";
    case "zh":
    default:
      return "关闭并清除规范检查 (Esc / ⌥⇧L)";
  }
}

export interface MarkdownLintFixInfo {
  readonly lineNumber?: number;
  readonly editColumn?: number;
  readonly deleteCount?: number;
  readonly insertText?: string;
}

/**
 * 根据 fixInfo 纯结构化状态字段生成地道建议（完全不依赖脆弱正则）
 */
export function describeFixInfo(
  fixInfo: MarkdownLintFixInfo,
  locale: LintLocale = getActiveLintLocale(),
): string {
  const deleteCount = fixInfo.deleteCount ?? 0;
  const insertText = fixInfo.insertText ?? "";

  if (locale === "ja") {
    if (fixInfo.deleteCount === -1) {
      return "提案: 余分な空行を削除";
    }
    if (insertText === " " && deleteCount === 0) {
      return "提案: ここに半角スペースを1つ追加";
    }
    if (insertText === "\n" && deleteCount === 0) {
      return "提案: ここに空行を1行追加して区切る";
    }
    if (deleteCount > 0 && !insertText) {
      return `提案: 不要な ${deleteCount} 文字を削除`;
    }
    if (deleteCount > 0 && insertText) {
      return `提案: "${insertText}" に置換`;
    }
    if (insertText) {
      return `提案: "${insertText}" を挿入`;
    }
    return "提案: 自動修正を適用";
  }

  if (locale === "zh-Hant") {
    if (fixInfo.deleteCount === -1) {
      return "建議：刪除此多餘空行";
    }
    if (insertText === " " && deleteCount === 0) {
      return "建議：在此處補充一個空格";
    }
    if (insertText === "\n" && deleteCount === 0) {
      return "建議：在此處補充一行空行隔開";
    }
    if (deleteCount > 0 && !insertText) {
      return `建議：刪除多餘的 ${deleteCount} 個字元`;
    }
    if (deleteCount > 0 && insertText) {
      return `建議：替換為 "${insertText}"`;
    }
    if (insertText) {
      return `建議：在此處插入 "${insertText}"`;
    }
    return "建議：自動格式化修復";
  }

  if (locale === "en") {
    if (fixInfo.deleteCount === -1) {
      return "Suggestion: Remove redundant blank line";
    }
    if (insertText === " " && deleteCount === 0) {
      return "Suggestion: Add a space here";
    }
    if (insertText === "\n" && deleteCount === 0) {
      return "Suggestion: Add a blank line separator";
    }
    if (deleteCount > 0 && !insertText) {
      return `Suggestion: Delete ${deleteCount} redundant character(s)`;
    }
    if (deleteCount > 0 && insertText) {
      return `Suggestion: Replace with "${insertText}"`;
    }
    if (insertText) {
      return `Suggestion: Insert "${insertText}"`;
    }
    return "Suggestion: Quick fix";
  }

  // zh (Simplified Chinese)
  if (fixInfo.deleteCount === -1) {
    return "建议：删除此多余空行";
  }
  if (insertText === " " && deleteCount === 0) {
    return "建议：在此处补充一个空格";
  }
  if (insertText === "\n" && deleteCount === 0) {
    return "建议：在此处补充一行空行隔开";
  }
  if (deleteCount > 0 && !insertText) {
    return `建议：删除多余的 ${deleteCount} 个字符`;
  }
  if (deleteCount > 0 && insertText) {
    return `建议：替换为 "${insertText}"`;
  }
  if (insertText) {
    return `建议：在此处插入 "${insertText}"`;
  }
  return "建议：自动格式化修复";
}

/**
 * 兼容旧名别名函数
 */
export function describeFixInfoInChinese(fixInfo: MarkdownLintFixInfo): string {
  return describeFixInfo(fixInfo, "zh");
}

/**
 * 将 markdownlint 生成的英文上下文详情（如 "Expected: h2; Actual: h3"）本地化为对应语言
 */
export function localizeMarkdownLintDetail(
  detail?: string,
  locale: LintLocale = getActiveLintLocale(),
): string | undefined {
  if (!detail) return undefined;

  if (locale === "ja") {
    return detail
      .replace(/^Expected:\s*([^;]+);\s*Actual:\s*(.+)$/i, "期待値: $1、実際: $2")
      .replace(/^Expected:\s*(.+)$/i, "期待値: $1")
      .replace(/^Actual:\s*(.+)$/i, "実際: $1")
      .replace(/Expected:\s*(\d+);\s*Actual:\s*(\d+)/gi, "期待値: $1、実際: $2")
      .replace(
        /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Below/gi,
        "期待空行数: $1、実際: $2（下部不足）",
      )
      .replace(
        /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Above/gi,
        "期待空行数: $1、実際: $2（上部不足）",
      );
  }

  if (locale === "zh-Hant") {
    return detail
      .replace(/^Expected:\s*([^;]+);\s*Actual:\s*(.+)$/i, "期望: $1，實際: $2")
      .replace(/^Expected:\s*(.+)$/i, "期望: $1")
      .replace(/^Actual:\s*(.+)$/i, "實際: $1")
      .replace(/Expected:\s*(\d+);\s*Actual:\s*(\d+)/gi, "期望: $1，實際: $2")
      .replace(
        /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Below/gi,
        "期望空行: $1，實際: $2（下方缺少）",
      )
      .replace(
        /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Above/gi,
        "期望空行: $1，實際: $2（上方缺少）",
      );
  }

  if (locale === "zh") {
    return detail
      .replace(/^Expected:\s*([^;]+);\s*Actual:\s*(.+)$/i, "期望: $1，实际: $2")
      .replace(/^Expected:\s*(.+)$/i, "期望: $1")
      .replace(/^Actual:\s*(.+)$/i, "实际: $1")
      .replace(/Expected:\s*(\d+);\s*Actual:\s*(\d+)/gi, "期望: $1，实际: $2")
      .replace(
        /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Below/gi,
        "期望空行: $1，实际: $2（下方缺少）",
      )
      .replace(
        /Expected:\s*(\d+);\s*Actual:\s*(\d+);\s*Above/gi,
        "期望空行: $1，实际: $2（上方缺少）",
      );
  }

  return detail;
}
