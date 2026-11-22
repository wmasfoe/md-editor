/**
 * @file optional-modules.ts
 * @description 可选重依赖的宿主接线：预加载 + 就绪后重算投影。
 *
 * 编辑器有三处同步渲染路径依赖较重的第三方包（HTML 消毒、MDX 解析、粘贴转换）。
 * 它们不在首屏静态图内：未就绪时投影层走既有降级路径（占位 / parserCoverage=partial），
 * 本模块负责在模块就绪后触发一次重算，把降级态升级为真实渲染。
 */

import { refreshMarkdownParseCoverageEffect } from "../../markdown/range-index.ts";
import {
  consumeOptionalModuleDegraded,
  onOptionalModuleReady,
  preloadOptionalModules,
} from "../../module-loader.ts";
import { refreshWysiwygProjectionEffect } from "../../wysiwyg/state/types.ts";
import type { RendererViewAdapter } from "../types.ts";

/**
 * 启动预加载并订阅就绪事件。
 *
 * @param getView 惰性取视图（控制器字段初始化早于视图构建，故用 getter）。
 * @returns 退订函数。
 */
export function attachOptionalModuleRefresh(
  getView: () => RendererViewAdapter | null | undefined,
): () => void {
  void preloadOptionalModules().catch(() => undefined);
  return onOptionalModuleReady(() => {
    // 只有加载期真的降级过才重算，避免凭空多派事务打断正在进行的编辑。
    if (!consumeOptionalModuleDegraded()) return;
    const view = getView();
    if (!view) return;
    view.dispatch({
      effects: [
        refreshWysiwygProjectionEffect.of(null),
        refreshMarkdownParseCoverageEffect.of(null),
      ],
    });
  });
}
