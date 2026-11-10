/**
 * @file index.ts
 * @description 渲染器自持样式的汇总入口与幂等注入。
 *
 * ## 为什么渲染器拥有样式
 *
 * 渲染器产出 DOM（CodeMirror 编辑区、WYSIWYG widget、lint/search 面板），因此它拥有
 * 这些 DOM 的渲染规则。历史上这些规则住在 `@md-editor/editor-ui` 且全部带
 * `.code-mirror-editor-host` 前缀——那是 React 宿主才挂的类。后果：任何非 React 宿主
 * 用 `createCodeMirrorRenderer` 拿到的都是无样式裸编辑器。
 *
 * 现在样式随 JS 模块发布、运行时幂等注入，宿主零配置。与 CodeMirror 自身的
 * `EditorView.baseTheme` + `style-mod`、Tiptap 的 `createStyleTag` + `style.ts` 常量，
 * 以及本仓库既有的 `media-viewer/styles.ts` 是同一范式。
 *
 * ## 宿主如何覆盖
 *
 * - 只想换配色：按 `theme-variables.ts` 的契约提供 `--theme-*` 变量即可（全部有 fallback）。
 * - 想完全接管样式：`createCodeMirrorRenderer({ injectStyles: false })`，然后自行引入
 *   `EDITOR_STYLE_CSS` 或写自己的规则。
 */

import { codeBlockCss } from "./code-block-css.ts";
import { canInjectInto, createDocumentStylePort, ensureStyleElement } from "./create-style-tag.ts";
import { coreEditorCss } from "./editor-core-css.ts";
import { directiveCss } from "./directive-css.ts";
import { lintCss } from "./lint-css.ts";
import { mathCss } from "./math-css.ts";
import { mermaidCss } from "./mermaid-css.ts";
import { searchCss } from "./search-css.ts";
import { tableCss } from "./table-css.ts";

/** `<style>` 元素的幂等键。 */
export const EDITOR_STYLE_ELEMENT_ID = "md-editor-renderer-style";

/**
 * 全部渲染器样式的拼接结果（按依赖顺序：基础 → 组件 → 面板）。
 *
 * 顺序有意义：后面的规则可以覆盖前面的同类选择器。
 */
export const EDITOR_STYLE_CSS = [
  coreEditorCss,
  tableCss,
  codeBlockCss,
  searchCss,
  directiveCss,
  mathCss,
  mermaidCss,
  lintCss,
].join("\n");

export interface InjectEditorStylesOptions {
  /** 目标文档；缺省用全局 `document`（浏览器）。 */
  readonly document?: Document;
  /** CSP nonce，透传给 `<style nonce="...">`。 */
  readonly nonce?: string;
}

/**
 * 幂等地把渲染器样式注入目标文档。
 *
 * 幂等语义：同一 `EDITOR_STYLE_ELEMENT_ID` 只存在一个 `<style>`；重复调用仅刷新内容
 * （内容相同则完全跳过），因此多次挂载编辑器或 HMR 不会累积重复规则。
 *
 * Node / SSR 环境无 `document` 时静默返回，不抛错。
 */
export function injectEditorStyles(options: InjectEditorStylesOptions = {}): void {
  const doc = options.document ?? (typeof document === "undefined" ? undefined : document);
  if (!doc) return;
  // 样式注入是尽力而为的辅助行为：宿主文档不完整（如单测 mock）时静默跳过，
  // 绝不让渲染器创建因此失败。
  if (!canInjectInto(doc)) return;
  ensureStyleElement({
    id: EDITOR_STYLE_ELEMENT_ID,
    css: EDITOR_STYLE_CSS,
    nonce: options.nonce,
    port: createDocumentStylePort(doc),
  });
}

export { ensureStyleElement, createDocumentStylePort } from "./create-style-tag.ts";
export type { StyleElementPort, StyleInjectionPort } from "./create-style-tag.ts";
export { THEME_VARIABLES, type ThemeVariableSpec } from "./theme-variables.ts";
