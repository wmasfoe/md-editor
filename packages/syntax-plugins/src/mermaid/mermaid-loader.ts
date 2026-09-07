import type MermaidType from "mermaid";

let mermaidInstance: typeof MermaidType | null = null;
let mermaidPromise: Promise<typeof MermaidType> | null = null;

const mermaidSvgCache = new Map<string, { svg: string; error?: string }>();
const MAX_CACHE_SIZE = 200;
let globalDiagramCounter = 0;
let currentTheme: "dark" | "default" | null = null;

/**
 * 动态按需加载 Mermaid 运行时模块（单例与并发去重）。
 */
export async function loadMermaid(): Promise<typeof MermaidType> {
  if (mermaidInstance) {
    return mermaidInstance;
  }
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((mod) => {
        mermaidInstance = mod.default ?? mod;
        mermaidInstance.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
        });
        return mermaidInstance;
      })
      .catch((err) => {
        mermaidPromise = null;
        throw err;
      });
  }
  return mermaidPromise;
}

export function getLoadedMermaid(): typeof MermaidType | null {
  return mermaidInstance;
}

/**
 * 异步将 Mermaid 源码渲染为 SVG 矢量图。
 * 具备并发缓存、语法错误隔离与暗黑模式适配。
 */
export async function renderMermaidSvg(
  code: string,
  isDark = false,
): Promise<{ svg: string; error?: string }> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { svg: "" };
  }

  const cacheKey = `${isDark ? "dark" : "light"}:${trimmed}`;
  const cached = mermaidSvgCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const mermaid = await loadMermaid();
  const id = `cm-mermaid-${Date.now()}-${++globalDiagramCounter}`;

  try {
    const targetTheme = isDark ? "dark" : "default";
    if (currentTheme !== targetTheme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: targetTheme,
        suppressErrorRendering: true,
      });
      currentTheme = targetTheme;
    }

    const { svg } = await mermaid.render(id, trimmed);
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
    const tempNode = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (tempNode && tempNode.parentElement) {
      tempNode.parentElement.removeChild(tempNode);
    }
    const tempContainer =
      typeof document !== "undefined" ? document.getElementById(`d${id}`) : null;
    if (tempContainer && tempContainer.parentElement) {
      tempContainer.parentElement.removeChild(tempContainer);
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    const result = { svg: "", error: errorMsg };
    mermaidSvgCache.set(cacheKey, result);
    return result;
  }
}
