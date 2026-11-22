/**
 * @file useMarkdownLintEngine.ts
 * @description 向编辑器注入 markdownlint 引擎（应用侧唯一入口）。
 *
 * 编辑器包不再静态依赖 markdownlint（1.2 MB + 42 个传递包）；需要 lint 的宿主自己安装并注入。
 * 这里集中处理三件容易写错的事：
 * 1. **不让 lint 进首屏**：`markdownlint/sync` 走动态 import。此前静态 import 会让桌面端
 *    首屏 chunk 直接背 1.2 MB；
 * 2. **引用稳定**：引擎对象参与 bridge 创建依赖，内联字面量会导致每次渲染重建编辑器；
 * 3. **不做类型断言**：编辑器端口类型已与官方 `LintError` / `LintResults` 对齐，
 *    官方 `lint` 可以直接赋给 `MarkdownLintEngine`（见 editor 的
 *    `official-type-parity.test.ts`）。此前这里写过 `as unknown as` 双重断言，
 *    那正是"文档示例不可用"的信号，类型对齐后已删除。
 *
 * 返回 `undefined` 表示引擎尚未就绪：调用方必须据此**关闭 lint 开关**再传入编辑器，
 * 就绪后把开关打开即可（编辑器侧 `ports.setMarkdownLintEngine` 会补注引擎，不重建视图）。
 */
import { useEffect, useState } from "react";
import type { MarkdownLintEngine } from "@md-editor/editor";

/**
 * 动态加载引擎。
 *
 * CJS 包经 ESM interop 后真实值可能挂在 `default` 上，两种形态都接。
 * 类型上无需任何断言：官方 `lint` 的结构与编辑器端口兼容（参数与返回值都已对齐）。
 */
export async function loadMarkdownLintEngine(): Promise<MarkdownLintEngine> {
  const mod = await import("markdownlint/sync");
  // 命名空间对象上没有 `default` 属性时，真实导出就是它本身。
  // 用 `in` 判断而不是断言：既避开"类型不重叠"的强制转换，也不需要 unknown 中转。
  const fallback = "default" in mod ? (mod as { default: typeof mod }).default : mod;
  return { lint: fallback.lint };
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
