/**
 * @file diagnostic-dom.ts
 * @description 为 CodeMirror Lint 诊断提示气泡提供 Apple Liquid Glass 风格的自绘 DOM 卡片。
 */

export interface DiagnosticDomOptions {
  readonly ruleCode?: string;
  readonly ruleAlias?: string;
  readonly description: string;
  readonly detail?: string;
  readonly severity?: "error" | "warning" | "info" | "hint";
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

  // 规则可读别名（如 heading-increment）
  if (options.ruleAlias) {
    const alias = document.createElement("span");
    alias.className = "cm-liquid-diagnostic__alias";
    alias.textContent = options.ruleAlias;
    topRow.appendChild(alias);
  }

  // 核心错误描述
  const desc = document.createElement("span");
  desc.className = "cm-liquid-diagnostic__desc";
  desc.textContent = options.description;
  topRow.appendChild(desc);

  container.appendChild(topRow);

  // 详细上下文信息（如 Expected: h2; Actual: h3）
  if (options.detail) {
    const detailRow = document.createElement("div");
    detailRow.className = "cm-liquid-diagnostic__detail";
    detailRow.textContent = options.detail;
    container.appendChild(detailRow);
  }

  return container;
}
