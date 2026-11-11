/**
 * @file theme-variables.ts
 * @description 渲染器消费的 `--theme-*` CSS 变量契约。
 *
 * ## 这份契约是什么
 *
 * 渲染器样式里每个颜色/字号/间距都写成 `var(--theme-xxx, <fallback>)`。
 * **全部变量都带 fallback**，因此：
 * - 不提供任何变量 → 渲染器仍有可用的中性外观（开箱即用）；
 * - 提供部分变量 → 只覆盖那部分；
 * - 提供全部变量 → 完全主题化。
 *
 * ## 宿主怎么用
 *
 * 在任意祖先元素上声明变量即可（通常 `:root`）：
 *
 * ```css
 * :root {
 *   --theme-bg: #ffffff;
 *   --theme-text: #24292f;
 *   --theme-primary: #0969da;
 * }
 * ```
 *
 * 也可以完全不写 CSS：`@md-editor/app-ui` 的 `compileThemeCss()` 会按主题配置
 * 生成这些变量。
 *
 * ## 维护约定
 *
 * 新增变量时：先在 `editor-styles` 相关片段里以 `var(--theme-new, <fallback>)` 形式使用，
 * 再把它登记到下面的 `THEME_VARIABLES`。`tests/styles/style-ownership.test.ts` 会断言
 * 「CSS 中出现的每个 `--theme-*` 都已登记」以及「登记的每个变量都被实际使用」，
 * 双向防止契约与实现漂移。
 */

/** 一个主题变量的契约描述。 */
export interface ThemeVariableSpec {
  /** 变量名，含 `--theme-` 前缀。 */
  readonly name: string;
  /** 分组（用于文档与主题编辑器归类）。 */
  readonly group: string;
  /** 该变量控制的视觉属性。 */
  readonly purpose: string;
}

/** 全部 `--theme-*` 变量的契约清单（按视觉职责分组）。 */
export const THEME_VARIABLES: readonly ThemeVariableSpec[] = [
  // ── 画布与表面 ──
  { name: "--theme-bg", group: "画布与表面", purpose: "画布底色" },
  { name: "--theme-bg-muted", group: "画布与表面", purpose: "次级底色（侧栏、嵌套区域）" },
  { name: "--theme-surface", group: "画布与表面", purpose: "卡片/浮层表面色" },
  // ── 文字 ──
  { name: "--theme-text", group: "文字", purpose: "正文文字色" },
  { name: "--theme-text-muted", group: "文字", purpose: "次级文字色" },
  { name: "--theme-muted", group: "文字", purpose: "弱化文字色（占位、辅助说明）" },
  { name: "--theme-title", group: "文字", purpose: "标题文字色" },
  // ── 边框与控件 ──
  { name: "--theme-border", group: "边框与控件", purpose: "常规边框色" },
  { name: "--theme-border-strong", group: "边框与控件", purpose: "强调边框色" },
  { name: "--theme-control-bg", group: "边框与控件", purpose: "控件底色" },
  { name: "--theme-control-border", group: "边框与控件", purpose: "控件边框色" },
  { name: "--theme-control-text", group: "边框与控件", purpose: "控件文字色" },
  { name: "--theme-control-subtle", group: "边框与控件", purpose: "控件弱化文字色" },
  { name: "--theme-control-hover", group: "边框与控件", purpose: "控件悬停底色" },
  { name: "--theme-control-active", group: "边框与控件", purpose: "控件激活底色" },
  // ── 强调色 ──
  { name: "--theme-primary", group: "强调色", purpose: "主强调色（描边、图标）" },
  { name: "--theme-primary-fill", group: "强调色", purpose: "主强调填充色（按钮背景）" },
  { name: "--theme-primary-hover", group: "强调色", purpose: "主强调悬停色" },
  { name: "--theme-primary-soft", group: "强调色", purpose: "主强调淡色（浅背景）" },
  { name: "--theme-primary-selected", group: "强调色", purpose: "主强调选中态" },
  { name: "--theme-accent", group: "强调色", purpose: "通用强调色" },
  // ── 代码 ──
  { name: "--theme-code", group: "代码", purpose: "行内代码文字色" },
  { name: "--theme-code-bg", group: "代码", purpose: "代码块背景" },
  { name: "--theme-code-border", group: "代码", purpose: "代码块边框" },
  { name: "--theme-code-accent", group: "代码", purpose: "代码块强调色" },
  { name: "--theme-code-gutter-bg", group: "代码", purpose: "代码块行号栏背景" },
  { name: "--theme-inline-code-bg", group: "代码", purpose: "行内代码背景" },
  { name: "--theme-keyword", group: "代码", purpose: "语法高亮：关键字" },
  { name: "--theme-string", group: "代码", purpose: "语法高亮：字符串" },
  { name: "--theme-number", group: "代码", purpose: "语法高亮：数字" },
  // ── 排版 ──
  { name: "--theme-font", group: "排版", purpose: "正文字体栈" },
  { name: "--theme-mono-font", group: "排版", purpose: "等宽字体栈" },
  { name: "--theme-ui-font", group: "排版", purpose: "界面字体栈" },
  { name: "--theme-heading-font", group: "排版", purpose: "标题字体栈" },
  { name: "--theme-editor-line-height", group: "排版", purpose: "编辑器行高" },
  { name: "--theme-source-line-height", group: "排版", purpose: "源码模式行高" },
  { name: "--theme-letter-spacing", group: "排版", purpose: "字距" },
  { name: "--theme-content-width", group: "排版", purpose: "正文最大宽度" },
  { name: "--theme-bold-font-weight", group: "排版", purpose: "加粗字重" },
  { name: "--theme-heading-font-weight", group: "排版", purpose: "标题字重" },
  // ── 行内标记 ──
  { name: "--theme-em-accent", group: "行内标记", purpose: "斜体标记强调色" },
  { name: "--theme-strong-accent", group: "行内标记", purpose: "加粗标记强调色" },
  { name: "--theme-del-accent", group: "行内标记", purpose: "删除线标记强调色" },
  { name: "--theme-marker-dim", group: "行内标记", purpose: "Markdown 标记淡化色" },
  { name: "--theme-highlight-bg", group: "行内标记", purpose: "高亮背景" },
  { name: "--theme-highlight-text", group: "行内标记", purpose: "高亮文字色" },
  { name: "--theme-link", group: "行内标记", purpose: "链接色" },
  { name: "--theme-list-marker", group: "行内标记", purpose: "列表符号色" },
  // ── 代码块与引用 ──
  { name: "--theme-blockquote-bg", group: "代码块与引用", purpose: "引用块背景" },
  { name: "--theme-blockquote-border", group: "代码块与引用", purpose: "引用块左边框" },
  { name: "--theme-blockquote-text", group: "代码块与引用", purpose: "引用块文字色" },
  { name: "--theme-heading-divider", group: "代码块与引用", purpose: "标题下划分隔线" },
  { name: "--theme-heading-accent", group: "代码块与引用", purpose: "标题强调装饰" },
  // ── 搜索 ──
  { name: "--theme-search-match", group: "搜索", purpose: "搜索匹配高亮" },
  { name: "--theme-search-match-active", group: "搜索", purpose: "当前搜索匹配" },
  { name: "--theme-search-match-outline", group: "搜索", purpose: "搜索匹配描边" },
  // ── 状态 ──
  { name: "--theme-danger", group: "状态", purpose: "危险态主色" },
  { name: "--theme-danger-bg", group: "状态", purpose: "危险态背景" },
  { name: "--theme-danger-text", group: "状态", purpose: "危险态文字色" },
  { name: "--theme-danger-soft", group: "状态", purpose: "危险态淡色" },
  { name: "--theme-focus-ring", group: "状态", purpose: "焦点环颜色" },
  { name: "--theme-glass-border", group: "状态", purpose: "玻璃材质边框" },
  { name: "--theme-surface-glass", group: "状态", purpose: "玻璃材质表面" },
  // ── 其它 ──
  { name: "--theme-checkbox-bg", group: "其它", purpose: "复选框背景" },
  { name: "--theme-checkbox-border", group: "其它", purpose: "复选框边框" },
  { name: "--theme-checkbox-check", group: "其它", purpose: "复选框勾选色" },
  { name: "--theme-input-bg", group: "其它", purpose: "输入框背景" },
  { name: "--theme-input-focus-bg", group: "其它", purpose: "输入框聚焦背景" },
  { name: "--theme-radius-base", group: "其它", purpose: "基础圆角" },
  { name: "--theme-shadow", group: "其它", purpose: "浮层阴影" },
];
