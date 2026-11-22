/**
 * @file useMarkdownLintEngine.ts
 * @description 向编辑器注入 markdownlint 引擎（应用侧唯一入口）。
 *
 * 编辑器包不再静态依赖 markdownlint（1.2 MB + 42 个传递包）；需要 lint 的宿主自己安装并注入。
 * 这里集中处理三件容易写错的事：
 * 1. **不让 lint 进首屏**：`markdownlint/sync` 走动态 import。此前静态 import 会让桌面端
 *    首屏 chunk 直接背 1.2 MB；
 * 2. **引用稳定**：引擎对象参与 bridge 创建依赖，内联字面量会导致每次渲染重建编辑器；
 * 3. **类型窄化**：markdownlint 的 `LintResults` 比编辑器端口宽，窄化只写一次。
 *
 * 返回 `undefined` 表示引擎尚未就绪：调用方必须据此**关闭 lint 开关**再传入编辑器，
 * 就绪后把开关打开即可（编辑器侧 `ports.setMarkdownLintEngine` 会补注引擎，不重建视图）。
 */
import { useEffect, useState } from "react";
import type { MarkdownLintEngine, MarkdownLintResult } from "@md-editor/editor";

type LintModule = { lint: (request: unknown) => unknown };

/**
 * 动态加载并窄化引擎。
 *
 * CJS 包经 ESM interop 后真实值可能挂在 `default` 上，两种形态都接。
 */
export async function loadMarkdownLintEngine(): Promise<MarkdownLintEngine> {
  const mod = await import("markdownlint/sync");
  const resolved = (mod as unknown as LintModule & { default?: LintModule }).default ?? mod;
  return {
    lint: (request) => resolved.lint({ ...request }) as unknown as MarkdownLintResult,
  };
}

export function useMarkdownLintEngine(): MarkdownLintEngine | undefined {
  const [loaded, setLoaded] = useState<MarkdownLintEngine | undefined>();

  useEffect(() => {
    let alive = true;
    void loadMarkdownLintEngine()
      .then((next) => {
        if (alive) setLoaded(next);
      })
      .catch(() => {
        // 加载失败（离线 / 被 CSP 拦）时保持"引擎未就绪"：调用方据此关闭 lint 开关，
        // 不产生未处理的 Promise rejection。
      });
    return () => {
      alive = false;
    };
  }, []);

  return loaded;
}
