import type MermaidType from "mermaid";

interface SerializedMermaidRuntime {
  render(id: string, source: string): Promise<{ svg: string }>;
  parse(source: string): Promise<unknown>;
}

let mermaidInstance: typeof MermaidType | null = null;
let mermaidPromise: Promise<typeof MermaidType> | null = null;
let operationQueue: Promise<void> = Promise.resolve();

const mermaidSvgCache = new Map<string, { svg: string; error?: string }>();
// 模块级并发渲染 Promise 缓存池，避免组件重绘或并发水合时触发重复渲染竞争
const inFlightPromises = new Map<string, Promise<{ svg: string; error?: string }>>();
const MAX_CACHE_SIZE = 200;
let globalDiagramCounter = 0;

/**
 * 动态按需加载 Mermaid 运行时模块（单例与并发去重）。
 */
async function loadMermaid(): Promise<typeof MermaidType> {
  if (mermaidInstance) {
    return mermaidInstance;
  }
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((mod) => {
        mermaidInstance = mod.default ?? mod;
        return mermaidInstance;
      })
      .catch((err) => {
        mermaidPromise = null;
        throw err;
      });
  }
  return mermaidPromise;
}

/** Serialize config changes with parsing and rendering because Mermaid config is global. */
export function runMermaidOperation<T>(
  isDark: boolean,
  operation: (mermaid: SerializedMermaidRuntime) => Promise<T>,
): Promise<T> {
  const result = operationQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: isDark ? "dark" : "default",
    });
    return operation(mermaid);
  });
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Validate with the same strict, serialized runtime used for normal rendering. */
export function parseMermaid(code: string, isDark = false): Promise<void> {
  return runMermaidOperation(isDark, async (mermaid) => {
    await mermaid.parse(code);
  });
}

/**
 * 异步将 Mermaid 源码渲染为 SVG 矢量图。
 * 具备并发缓存、语法错误隔离与暗黑模式适配。
 */
export function renderMermaidSvg(
  code: string,
  isDark = false,
): Promise<{ svg: string; error?: string }> {
  const trimmed = code.trim();
  if (!trimmed) {
    return Promise.resolve({ svg: "" });
  }

  const cacheKey = `${isDark ? "dark" : "light"}:${trimmed}`;
  const cached = mermaidSvgCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  // 并发请求复用：若该图表已在渲染中，直接复用其 Promise，避免重复调用 mermaid.render 产生竞态
  const inFlight = inFlightPromises.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const renderPromise = (async () => {
    const id = `cm-mermaid-${Date.now()}-${++globalDiagramCounter}`;

    try {
      const { svg } = await runMermaidOperation(isDark, (mermaid) => mermaid.render(id, trimmed));
      const result = { svg };

      if (mermaidSvgCache.size >= MAX_CACHE_SIZE) {
        const firstKey = mermaidSvgCache.keys().next().value;
        if (firstKey !== undefined) {
          mermaidSvgCache.delete(firstKey);
        }
      }
      mermaidSvgCache.set(cacheKey, result);
      return result;
    } catch (err) {
      // 清理可能残留在 DOM 中的临时 mermaid 容器
      const tempNode =
        typeof document !== "undefined" && typeof document.getElementById === "function"
          ? document.getElementById(id)
          : null;
      if (tempNode && tempNode.parentElement) {
        tempNode.parentElement.removeChild(tempNode);
      }
      const tempContainer =
        typeof document !== "undefined" && typeof document.getElementById === "function"
          ? document.getElementById(`d${id}`)
          : null;
      if (tempContainer && tempContainer.parentElement) {
        tempContainer.parentElement.removeChild(tempContainer);
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      const result = { svg: "", error: errorMsg };
      mermaidSvgCache.set(cacheKey, result);
      return result;
    } finally {
      inFlightPromises.delete(cacheKey);
    }
  })();

  inFlightPromises.set(cacheKey, renderPromise);
  return renderPromise;
}
