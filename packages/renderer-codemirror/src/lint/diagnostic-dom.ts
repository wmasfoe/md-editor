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

  // 严重级别微标与规则码胶囊
  if (options.ruleCode) {
    const badge = document.createElement("span");
    badge.className = `cm-liquid-diagnostic__badge cm-liquid-diagnostic__badge--${severity}`;
    badge.textContent = options.ruleCode;
    topRow.appendChild(badge);
  }

  const activeLocale = options.locale ?? getActiveLintLocale();
  const ruleInfo = options.ruleCode
    ? getMarkdownLintRuleInfo(options.ruleCode, activeLocale)
    : undefined;

  // 规则可读别名（如 "见出しレベルの順次増加"、"标题层级递增" 或 "Heading increment"）
  const displayAlias = ruleInfo?.alias ?? options.ruleAlias;
  if (displayAlias) {
    const alias = document.createElement("span");
    alias.className = "cm-liquid-diagnostic__alias";
    alias.textContent = displayAlias;
    topRow.appendChild(alias);
  }

  if (options.ruleCode || displayAlias) {
    container.appendChild(topRow);
  }

  // 核心错误描述
  const displayDesc = ruleInfo?.description ?? options.description;
  if (displayDesc) {
    const desc = document.createElement("div");
    desc.className = "cm-liquid-diagnostic__desc";
    desc.textContent = displayDesc;
    container.appendChild(desc);
  }

  // 详细上下文信息
  const rawDetail = options.detail;
  const displayDetail = localizeMarkdownLintDetail(rawDetail, activeLocale);
  if (displayDetail) {
    const detailRow = document.createElement("div");
    detailRow.className = "cm-liquid-diagnostic__detail";
    detailRow.textContent = displayDetail;
    container.appendChild(detailRow);
  }

  return container;
}
