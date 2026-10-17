/**
 * @file katex-styles.ts
 * @description KaTeX 官方样式的唯一装载点。
 *
 * 样式归属于 `@md-editor/syntax-plugins`（本包声明了 `katex` 依赖），其他接入端不再全局
 * `@import "katex/dist/katex.min.css"`：
 * - 全局引入会在不声明 `katex` 的应用里形成幽灵依赖，并与本模块形成重复投放；
 * - 本模块只被 `math-loader.ts` 以动态 `import()` 引用，因此样式随公式按需加载，
 *   无公式文档首屏不加载 KaTeX 样式。
 *
 * 这里使用**副作用导入**（不带绑定）：与 `packages/editor-ui` 的 CSS 引入方式一致，
 * 不需要额外的 `*.css` 模块类型声明。
 */
import "katex/dist/katex.min.css";

export const KATEX_STYLESHEET_MODULE = "katex/dist/katex.min.css";
