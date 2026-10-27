import { Facet, type Extension, type EditorState, type TransactionSpec } from "@codemirror/state";
import { linter, lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorView, keymap } from "@codemirror/view";
import { runMarkdownLint } from "./markdown-lint.ts";
import { runLinkValidation } from "./link-lint.ts";
import {
  clearMarkdownLintCommand,
  countActiveMarkdownLintDiagnostics,
  collectPreservedNonMarkdownDiagnostics,
} from "./commands.ts";
import type { DocumentLinterOptions, LinkLintOptions } from "./types.ts";

export * from "./types.ts";
export * from "./commands.ts";
export { runMarkdownLint } from "./markdown-lint.ts";
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
 * 主题自适应 Apple 毛玻璃风格 CodeMirror Lint 诊断气泡与波浪线主题扩展
 */
export const lintLiquidTheme = EditorView.baseTheme({
  ".cm-tooltip:has(.cm-tooltip-lint), .cm-tooltip.cm-tooltip-lint": {
    border: "1px solid var(--theme-border-strong, rgba(0, 0, 0, 0.12))",
    backgroundColor: "var(--theme-surface, #ffffff)",
    backdropFilter: "blur(24px) saturate(190%)",
    WebkitBackdropFilter: "blur(24px) saturate(190%)",
    borderRadius: "12px",
    boxShadow:
      "0 1px 0 0 color-mix(in srgb, var(--theme-surface, #fff) 60%, transparent) inset, var(--theme-shadow, 0 12px 32px -4px rgba(0, 0, 0, 0.14))",
    padding: "0",
    maxWidth: "440px",
    minWidth: "280px",
    zIndex: "999",
    color: "var(--theme-text, #24292f)",
    overflow: "hidden",
  },
  "&dark .cm-tooltip:has(.cm-tooltip-lint), &dark .cm-tooltip.cm-tooltip-lint": {
    border: "1px solid var(--theme-border-strong, rgba(255, 255, 255, 0.15))",
    backgroundColor: "var(--theme-surface, #14171d)",
    boxShadow:
      "0 1px 0 0 rgba(255, 255, 255, 0.08) inset, var(--theme-shadow, 0 16px 40px -4px rgba(0, 0, 0, 0.65))",
    color: "var(--theme-text, #d7dae0)",
  },
  ".cm-tooltip:has(.cm-tooltip-lint) .cm-tooltip-arrow, .cm-tooltip.cm-tooltip-lint .cm-tooltip-arrow":
    {
      display: "none !important",
    },
  ".cm-tooltip-lint": {
    listStyle: "none",
    padding: "0",
    margin: "0",
    backgroundColor: "transparent",
  },
  ".cm-diagnostic": {
    borderLeft: "none !important",
    padding: "8px 12px !important",
    margin: "0 !important",
    display: "flex !important",
    flexDirection: "row !important",
    alignItems: "center !important",
    justifyContent: "space-between !important",
    gap: "12px !important",
    backgroundColor: "transparent !important",
    fontFamily:
      "var(--theme-font, -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif) !important",
  },
  ".cm-diagnosticText": {
    flex: "1 1 auto",
    minWidth: "0",
    color: "var(--theme-text, inherit)",
    fontSize: "13px",
    lineHeight: "1.4",
  },
  ".cm-diagnosticSource": {
    display: "none !important",
  },
  ".cm-diagnostic + .cm-diagnostic": {
    borderTop: "1px solid var(--theme-border, rgba(0, 0, 0, 0.06)) !important",
    marginTop: "0 !important",
    paddingTop: "8px !important",
  },
  "&dark .cm-diagnostic + .cm-diagnostic": {
    borderTop: "1px solid var(--theme-border, rgba(255, 255, 255, 0.08)) !important",
  },
  ".cm-diagnostic-error": {
    backgroundColor: "transparent !important",
  },
  ".cm-diagnostic-warning": {
    backgroundColor: "transparent !important",
  },
  ".cm-diagnosticAction": {
    flexShrink: "0 !important",
    display: "inline-flex !important",
    alignItems: "center !important",
    justifyContent: "center !important",
    height: "24px !important",
    padding: "0 10px !important",
    borderRadius: "5px !important",
    fontSize: "11.5px !important",
    fontWeight: "500 !important",
    cursor: "pointer !important",
    transition: "all 120ms cubic-bezier(0.16, 1, 0.3, 1) !important",
    whiteSpace: "nowrap !important",
    userSelect: "none !important",
    backgroundColor: "var(--theme-primary-soft, rgba(9, 105, 218, 0.08)) !important",
    color: "var(--theme-primary, #0969da) !important",
    border:
      "1px solid color-mix(in srgb, var(--theme-primary, #0969da) 25%, transparent) !important",
    boxShadow: "0 1px 2px rgba(9, 105, 218, 0.06) !important",
  },
  ".cm-diagnosticAction:hover": {
    backgroundColor: "var(--theme-primary, #0969da) !important",
    borderColor: "var(--theme-primary, #0969da) !important",
    color: "#ffffff !important",
    boxShadow: "0 2px 6px rgba(9, 105, 218, 0.25) !important",
  },
  ".cm-diagnosticAction:active": {
    transform: "scale(0.97) !important",
  },
  "&dark .cm-diagnosticAction": {
    backgroundColor: "rgba(122, 162, 247, 0.12) !important",
    borderColor: "rgba(122, 162, 247, 0.25) !important",
    color: "#a5c2ff !important",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25) !important",
  },
  "&dark .cm-diagnosticAction:hover": {
    backgroundColor: "#3b69b5 !important",
    borderColor: "#7aa2f7 !important",
    color: "#ffffff !important",
    boxShadow: "0 2px 6px rgba(122, 162, 247, 0.35) !important",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none !important",
    borderBottom: "none !important",
    textDecoration: "underline wavy var(--theme-danger-text, #ef4444) !important",
    textUnderlineOffset: "3.5px !important",
    textDecorationSkipInk: "none !important",
    paddingBottom: "0 !important",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none !important",
    borderBottom: "none !important",
    textDecoration: "underline wavy #f59e0b !important",
    textUnderlineOffset: "3.5px !important",
    textDecorationSkipInk: "none !important",
    paddingBottom: "0 !important",
  },
  ".cm-liquid-diagnostic": {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: "6px",
    flexWrap: "wrap",
    width: "100%",
    lineHeight: "1.4",
  },
  ".cm-liquid-diagnostic__header": {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: "0",
  },
  ".cm-liquid-diagnostic__badge": {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 5px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: "500",
    letterSpacing: "0.02em",
    lineHeight: "1.2",
    fontFamily: "var(--theme-mono-font, ui-monospace, SFMono-Regular, monospace)",
  },
  ".cm-liquid-diagnostic__badge--error": {
    backgroundColor: "var(--theme-danger-bg, rgba(239, 68, 68, 0.1))",
    color: "var(--theme-danger-text, #cf222e)",
    border: "1px solid color-mix(in srgb, var(--theme-danger-text, #cf222e) 22%, transparent)",
  },
  "&dark .cm-liquid-diagnostic__badge--error": {
    backgroundColor: "rgba(255, 123, 114, 0.12)",
    color: "#ff7b72",
    borderColor: "rgba(255, 123, 114, 0.25)",
  },
  ".cm-liquid-diagnostic__badge--warning": {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    color: "#d97706",
    border: "1px solid rgba(245, 158, 11, 0.25)",
  },
  "&dark .cm-liquid-diagnostic__badge--warning": {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    color: "#f59e0b",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  ".cm-liquid-diagnostic__badge--info": {
    backgroundColor: "var(--theme-primary-soft, rgba(59, 130, 246, 0.1))",
    color: "var(--theme-primary, #0969da)",
    border: "1px solid color-mix(in srgb, var(--theme-primary, #0969da) 22%, transparent)",
  },
  ".cm-liquid-diagnostic__desc": {
    fontSize: "13px",
    fontWeight: "500",
    color: "var(--theme-title, #1f2328)",
    lineHeight: "1.4",
    flex: "1 1 auto",
  },
  "&dark .cm-liquid-diagnostic__desc": {
    color: "var(--theme-title, #f1f3f5)",
  },
  ".cm-liquid-diagnostic__detail": {
    width: "100%",
    fontFamily: "var(--theme-mono-font, ui-monospace, SFMono-Regular, monospace)",
    fontSize: "11px",
    color: "var(--theme-muted, #656d76)",
    paddingLeft: "1px",
    marginTop: "2px",
    lineHeight: "1.35",
    backgroundColor: "transparent",
    border: "none",
  },
  "&dark .cm-liquid-diagnostic__detail": {
    color: "var(--theme-muted, #8b949e)",
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
});

/**
 * 实时 Markdown 规范检查最大字符保护阈值（约 4,000+ 行），超过则跳过自动后台全量扫描以保护打字流畅度
 */
export const MAX_REALTIME_LINT_DOC_CHARS = 120_000;

/**
 * 提供 CM6 原生 Lint 常驻底座（包含状态字段挂载、快捷键导航以及 Liquid Glass 毛玻璃气泡视觉定制）
 * 不挂载任何自动轮询源，零定时器与零静态检查开销。
 */
export function createLintBaseExtensions(): Extension {
  return [
    linter(null),
    keymap.of([
      ...lintKeymap,
      {
        key: "Escape",
        run(view) {
          if (countActiveMarkdownLintDiagnostics(view.state) > 0) {
            clearMarkdownLintCommand(view);
            return true;
          }
          return false;
        },
      },
    ]),
    lintLiquidTheme,
    EditorView.domEventHandlers({
      mouseenter(event) {
        const target = event.target as HTMLElement | null;
        const closeBtn = target?.closest?.(".cm-panel-lint [name='close']");
        if (closeBtn && !closeBtn.getAttribute("title")) {
          closeBtn.setAttribute("title", "关闭并清除规范检查 (Esc / ⌥⇧L)");
        }
      },
      click(event, view) {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(".cm-panel-lint [name='close']")) {
          // 用户点击底部诊断面板右上角 × 按钮时，同步清除文档内的 markdownlint 波浪线标记并收起
          clearMarkdownLintCommand(view);
        }
      },
      keydown(event, view) {
        if (event.key === "Escape") {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.(".cm-panel-lint")) {
            // 在底部面板内按 Esc 时同步清除标记
            clearMarkdownLintCommand(view);
          }
        }
      },
    }),
  ];
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
