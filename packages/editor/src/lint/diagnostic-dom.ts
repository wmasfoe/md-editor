/**
 * @file diagnostic-dom.ts
 * @description 为 CodeMirror Lint 诊断提示气泡提供 Apple Liquid Glass 风格的自绘 DOM 卡片。
 */

import {
  getActiveLintLocale,
  getMarkdownLintRuleInfo,
  localizeMarkdownLintDetail,
  type LintLocale,
} from "./markdown-lint-i18n.ts";

export interface DiagnosticDomOptions {
  readonly ruleCode?: string;
  readonly ruleAlias?: string;
  readonly description: string;
  readonly detail?: string;
  readonly severity?: "error" | "warning" | "info" | "hint";
  readonly locale?: LintLocale;
}

/**
 * 构造具有 Apple 毛玻璃与圆角胶囊视觉层级的诊断信息 DOM 节点
 */
export function createDiagnosticDomNode(options: DiagnosticDomOptions): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const container = document.createElement("div");
  container.className = "cm-liquid-diagnostic";

  const topRow = document.createElement("div");
  topRow.className = "cm-liquid-diagnostic__header";

  const severity = options.severity ?? "error";

  // 严重级别徽标与规则码胶囊（如 MD001）
  if (options.ruleCode) {
    const badge = document.createElement("span");
    badge.className = `cm-liquid-diagnostic__badge cm-liquid-diagnostic__badge--${severity}`;
    badge.textContent = options.ruleCode;
    topRow.appendChild(badge);
  }

  container.appendChild(topRow);

  const activeLocale = options.locale ?? getActiveLintLocale();
  const ruleInfo = options.ruleCode
    ? getMarkdownLintRuleInfo(options.ruleCode, activeLocale)
    : undefined;

  // 简明核心规则描述（去除多余说教与例证，纯正标准 Linter 风格）
  const displayDesc =
    ruleInfo?.description ?? options.description ?? ruleInfo?.alias ?? options.ruleAlias;
  if (displayDesc) {
    const desc = document.createElement("div");
    desc.className = "cm-liquid-diagnostic__desc";
    desc.textContent = displayDesc;
    container.appendChild(desc);
  }

  // 真实上下文参数与对比信息（如 "期望: h2，实际: h3"）
  // 严格去除 Emoji（💡、ℹ️）及提示气泡，作为低调字号的次级说明呈现，杜绝 AI 说教味
  const rawDetail = options.detail;
  const displayDetail = localizeMarkdownLintDetail(rawDetail, activeLocale);
  const isRedundantSuggestion =
    displayDetail &&
    (displayDetail.startsWith("建议") ||
      displayDetail.startsWith("提案") ||
      displayDetail.startsWith("建議") ||
      displayDetail.startsWith("Suggestion"));

  if (displayDetail && !isRedundantSuggestion) {
    const detailRow = document.createElement("div");
    detailRow.className = "cm-liquid-diagnostic__detail";
    detailRow.textContent = displayDetail;
    container.appendChild(detailRow);
  }

  return container;
}
