import { Facet, type Extension, type EditorState, type TransactionSpec } from "@codemirror/state";
import {
  forEachDiagnostic,
  linter,
  lintKeymap,
  setDiagnostics,
  type Diagnostic,
} from "@codemirror/lint";
import { EditorView, keymap } from "@codemirror/view";
import { runMarkdownLint } from "./markdown-lint.ts";
import { runLinkValidation } from "./link-lint.ts";
import type { DocumentLinterOptions, LinkLintOptions } from "./types.ts";

export * from "./types.ts";
export { runLinkValidation } from "./link-lint.ts";
export { createDiagnosticDomNode } from "./diagnostic-dom.ts";

/**
 * 链接检查探针选项 Facet
 */
export const linkLintOptionsFacet = Facet.define<LinkLintOptions, LinkLintOptions>({
  combine(values) {
    return values.at(-1) ?? {};
  },
});

/**
 * Apple Liquid Glass 风格 CodeMirror Lint 主题扩展
 */
export const lintLiquidTheme = EditorView.baseTheme({
  ".cm-tooltip.cm-tooltip-lint": {
    border: "1px solid rgba(0, 0, 0, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    backdropFilter: "blur(20px) saturate(190%)",
    WebkitBackdropFilter: "blur(20px) saturate(190%)",
    borderRadius: "12px",
    boxShadow:
      "0 1px 1px 0 rgba(255, 255, 255, 0.95) inset, 0 10px 30px -4px rgba(0, 0, 0, 0.12), 0 2px 8px -2px rgba(0, 0, 0, 0.06)",
    padding: "6px 8px",
    maxWidth: "480px",
    zIndex: "999",
    overflow: "hidden",
  },
  "&dark .cm-tooltip.cm-tooltip-lint": {
    border: "1px solid rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(28, 30, 36, 0.88)",
    boxShadow:
      "0 1px 1px 0 rgba(255, 255, 255, 0.12) inset, 0 14px 36px -4px rgba(0, 0, 0, 0.55), 0 4px 12px -2px rgba(0, 0, 0, 0.3)",
  },
  ".cm-tooltip-lint ul": {
    listStyle: "none",
    padding: "0",
    margin: "0",
  },
  ".cm-diagnostic": {
    borderLeft: "none !important",
    padding: "4px 6px !important",
    margin: "0 !important",
    display: "flex !important",
    alignItems: "flex-start !important",
    gap: "6px !important",
    borderRadius: "8px !important",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif !important",
  },
  ".cm-diagnosticText": {
    flex: "1 1 auto",
  },
  ".cm-diagnostic + .cm-diagnostic": {
    borderTop: "1px solid rgba(0, 0, 0, 0.06) !important",
    marginTop: "4px !important",
    paddingTop: "6px !important",
  },
  "&dark .cm-diagnostic + .cm-diagnostic": {
    borderTop: "1px solid rgba(255, 255, 255, 0.08) !important",
  },
  ".cm-diagnostic-error": {
    backgroundColor: "transparent !important",
  },
  ".cm-diagnostic-warning": {
    backgroundColor: "transparent !important",
  },
  ".cm-diagnosticAction": {
    backgroundColor: "rgba(0, 0, 0, 0.06) !important",
    color: "inherit !important",
    border: "1px solid rgba(0, 0, 0, 0.08) !important",
    borderRadius: "6px !important",
    padding: "2px 8px !important",
    fontSize: "11px !important",
    fontWeight: "500 !important",
    cursor: "pointer !important",
    transition: "all 120ms ease !important",
  },
  ".cm-diagnosticAction:hover": {
    backgroundColor: "rgba(0, 0, 0, 0.12) !important",
  },
  "&dark .cm-diagnosticAction": {
    backgroundColor: "rgba(255, 255, 255, 0.1) !important",
    borderColor: "rgba(255, 255, 255, 0.15) !important",
  },
  "&dark .cm-diagnosticAction:hover": {
    backgroundColor: "rgba(255, 255, 255, 0.2) !important",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none !important",
    borderBottom: "1.5px dashed #ef4444 !important",
    paddingBottom: "1px !important",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none !important",
    borderBottom: "1.5px dashed #f59e0b !important",
    paddingBottom: "1px !important",
  },
  ".cm-liquid-diagnostic": {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  ".cm-liquid-diagnostic__header": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    lineHeight: "1.4",
  },
  ".cm-liquid-diagnostic__badge": {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 6px",
    borderRadius: "9999px",
    fontSize: "10.5px",
    fontWeight: "600",
    letterSpacing: "0.02em",
    lineHeight: "1.2",
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
  },
  ".cm-liquid-diagnostic__badge--error": {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    color: "#dc2626",
    border: "1px solid rgba(239, 68, 68, 0.25)",
  },
  "&dark .cm-liquid-diagnostic__badge--error": {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    color: "#f87171",
    borderColor: "rgba(239, 68, 68, 0.35)",
  },
  ".cm-liquid-diagnostic__badge--warning": {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    color: "#d97706",
    border: "1px solid rgba(245, 158, 11, 0.25)",
  },
  "&dark .cm-liquid-diagnostic__badge--warning": {
    backgroundColor: "rgba(245, 158, 11, 0.2)",
    color: "#fbbf24",
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  ".cm-liquid-diagnostic__badge--info": {
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    color: "#2563eb",
    border: "1px solid rgba(59, 130, 246, 0.25)",
  },
  ".cm-liquid-diagnostic__alias": {
    fontSize: "11px",
    fontWeight: "500",
    color: "rgba(0, 0, 0, 0.55)",
    fontFamily: "ui-monospace, monospace",
  },
  "&dark .cm-liquid-diagnostic__alias": {
    color: "rgba(255, 255, 255, 0.55)",
  },
  ".cm-liquid-diagnostic__desc": {
    fontSize: "12px",
    color: "#1f2328",
    fontWeight: "450",
  },
  "&dark .cm-liquid-diagnostic__desc": {
    color: "#f0f6fc",
  },
  ".cm-liquid-diagnostic__detail": {
    fontSize: "11px",
    color: "rgba(0, 0, 0, 0.6)",
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    backgroundColor: "rgba(0, 0, 0, 0.04)",
    padding: "2px 6px",
    borderRadius: "4px",
    marginTop: "2px",
    wordBreak: "break-all",
  },
  "&dark .cm-liquid-diagnostic__detail": {
    color: "rgba(255, 255, 255, 0.65)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
});

/**
 * 实时 Markdown 规范检查最大字符保护阈值（约 4,000+ 行），超过则跳过自动后台全量扫描以保护打字流畅度
 */
export const MAX_REALTIME_LINT_DOC_CHARS = 120_000;

/**
 * 收集当前 state 中除 markdownlint 以外的既有诊断（例如手动链接检查结果），避免被实时轮询覆盖
 */
export function collectPreservedNonMarkdownDiagnostics(state: EditorState): Diagnostic[] {
  const preserved: Diagnostic[] = [];
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (diagnostic.source !== "markdownlint") {
      preserved.push({
        ...diagnostic,
        from,
        to,
      });
    }
  });
  return preserved;
}

/**
 * 清除所有 markdownlint 产生的波浪线诊断，同时保留其他来源诊断
 */
export function clearMarkdownLintDiagnostics(state: EditorState): TransactionSpec {
  const preserved = collectPreservedNonMarkdownDiagnostics(state);
  return setDiagnostics(state, preserved);
}

/**
 * 提供 CM6 原生 Lint 常驻底座（包含状态字段挂载、快捷键导航以及 Liquid Glass 毛玻璃气泡视觉定制）
 * 不挂载任何自动轮询源，零定时器与零静态检查开销。
 */
export function createLintBaseExtensions(): Extension {
  return [linter(null), keymap.of(lintKeymap), lintLiquidTheme];
}

/**
 * 创建可热插拔的实时 Markdown 规范检查扩展。
 * 当 enabled 为 false 时返回空扩展；
 * 当 enabled 为 true 时防抖 600ms 同步检查并在主视口展示波浪线。
 */
export function createRealtimeMarkdownLintExtension(enabled: boolean): Extension {
  if (!enabled) {
    return [];
  }
  return linter(
    async (view) => {
      const preserved = collectPreservedNonMarkdownDiagnostics(view.state);
      if (view.state.doc.length > MAX_REALTIME_LINT_DOC_CHARS) {
        return preserved;
      }
      const { runMarkdownLint: runLint } = await import("./markdown-lint.ts");
      const mdDiagnostics = runLint(view.state);
      return [...preserved, ...mdDiagnostics];
    },
    { delay: 600 },
  );
}

/**
 * 执行完整的 Markdown 格式与本地链接检查，并将结果分发至 EditorView
 */
export async function executeDocumentLint(
  view: { readonly state: EditorState; dispatch(spec: TransactionSpec): void },
  options: DocumentLinterOptions = {},
): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  if (options.enableMarkdownLint !== false) {
    const mdDiagnostics = runMarkdownLint(view.state, options.markdownlintConfig);
    diagnostics.push(...mdDiagnostics);
  }

  if (options.enableLinkCheck !== false && options.validateLinks) {
    const linkDiagnostics = await runLinkValidation(view.state, options);
    diagnostics.push(...linkDiagnostics);
  }

  view.dispatch(setDiagnostics(view.state, diagnostics));
  return diagnostics;
}
