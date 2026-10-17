import type KatexType from "katex";

let katexInstance: typeof KatexType | null = null;
let katexPromise: Promise<typeof KatexType> | null = null;
let katexStylesheetPromise: Promise<unknown> | null = null;

const mathRenderCache = new Map<string, { html: string; error?: string }>();
const MAX_CACHE_SIZE = 1000;

/**
 * 惰性加载 KaTeX 官方样式（单例、幂等）。
 *
 * 样式唯一来源在本包：`@md-editor/syntax-plugins` 声明了 `katex` 依赖，因此各接入端不再
 * 需要（也不应该）在全局入口 `@import "katex/dist/katex.min.css"` —— 全局引入会形成幽灵依赖，
 * 并与这里形成重复投放；同时避免无公式文档首屏加载样式。
 *
 * 触发时机：
 * - 编辑器路径：由公式 widget 与 `renderMathHtml()` 的未就绪兜底分支经 `loadKatex()` 触发；
 * - 静态渲染路径（如移动端阅读器把 compiler 输出注入宿主 DOM）：由接入端显式调用本函数。
 *
 * 加载失败不致命：公式仍以无样式 HTML 呈现，避免整条渲染链因样式缺失而中断。
 */
export function ensureKatexStylesheet(): Promise<unknown> {
  if (!katexStylesheetPromise) {
    // 样式写入独立模块（副作用导入 CSS），确保 bundler 将它拆成随需加载的样式产物。
    katexStylesheetPromise = import("./katex-styles.ts").catch(() => undefined);
  }
  return katexStylesheetPromise;
}

/**
 * 动态按需加载 KaTeX 运行时与样式（支持单例与并发去重）。
 *
 * 惰性契约：本模块**不得**在模块作用域触发加载，只在真实需要渲染公式时调用
 * （调用方为 `math-projection` 的公式 widget，以及 `renderMathHtml` 的未就绪兜底分支）。
 */
export async function loadKatex(): Promise<typeof KatexType> {
  if (katexInstance) {
    return katexInstance;
  }
  if (!katexPromise) {
    katexPromise = Promise.all([import("katex"), ensureKatexStylesheet()])
      .then(([mod]) => {
        katexInstance = mod.default ?? mod;
        return katexInstance;
      })
      .catch((err) => {
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}

/**
 * 同步尝试获取已加载的 KaTeX 实例。
 */
export function getLoadedKatex(): typeof KatexType | null {
  return katexInstance;
}

/**
 * 极速渲染数学公式为 HTML。
 * - 若 KaTeX 已就绪：立即执行同步渲染并存入 LRU 缓存；
 * - 若 KaTeX 正在加载中：返回优雅加载占位，并在后台触发模块加载；
 * - 语法错误时：throwOnError 设为 false，输出 KaTeX 内置错误标记并记录 error。
 */
export function renderMathHtml(
  expression: string,
  displayMode: boolean,
): { html: string; error?: string } {
  const cacheKey = `${displayMode ? "D" : "I"}:${expression}`;
  const cached = mathRenderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const katex = getLoadedKatex();
  if (!katex) {
    // 异步拉取，等待后续重绘
    void loadKatex();
    return {
      html: `<span class="cm-md-math-loading" aria-label="Loading math...">${escapeHtml(expression)}</span>`,
    };
  }

  try {
    const html = katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      errorColor: "#cf222e",
      strict: false,
    });
    const result = { html };

    if (mathRenderCache.size >= MAX_CACHE_SIZE) {
      const firstKey = mathRenderCache.keys().next().value;
      if (firstKey !== undefined) {
        mathRenderCache.delete(firstKey);
      }
    }
    mathRenderCache.set(cacheKey, result);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result = {
      html: `<span class="cm-md-math-error" title="${escapeHtml(errorMsg)}">${escapeHtml(expression)}</span>`,
      error: errorMsg,
    };
    mathRenderCache.set(cacheKey, result);
    return result;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
