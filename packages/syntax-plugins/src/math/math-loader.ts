import type KatexType from "katex";

let katexInstance: typeof KatexType | null = null;
let katexPromise: Promise<typeof KatexType> | null = null;

const mathRenderCache = new Map<string, { html: string; error?: string }>();
const MAX_CACHE_SIZE = 1000;

/**
 * 动态按需加载 KaTeX 模块（支持单例与并发去重）。
 */
export async function loadKatex(): Promise<typeof KatexType> {
  if (katexInstance) {
    return katexInstance;
  }
  if (!katexPromise) {
    katexPromise = import("katex")
      .then((mod) => {
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

// 浏览器/客户端环境下尽早预加载 KaTeX，避免文档加载时异步排版跳变
if (typeof window !== "undefined" && typeof document !== "undefined") {
  void loadKatex().catch(() => {
    // 静默处理预加载失败，由后续实际渲染环节安全兜底
  });
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
