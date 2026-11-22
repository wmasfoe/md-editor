/**
 * @file optional-modules.ts
 * @description 可选重依赖的宿主接线：预加载 + 就绪后按**用途**重算投影。
 *
 * 编辑器有三处同步渲染路径依赖较重的第三方包，各自影响不同的投影：
 *
 * | 模块 | 未就绪时的降级 | 就绪后需要刷新 |
 * | --- | --- | --- |
 * | `sanitize-html` | HTML 块渲染 "Loading HTML preview…" 占位 | 仅 WYSIWYG 投影 |
 * | `mdx-parser` | MDX 块 `parserCoverage=partial`（源码可见） | 解析索引 + 投影 |
 * | `turndown` | 粘贴降级为浏览器默认（纯文本） | **无需派发任何事务** |
 *
 * 因此就绪通知必须携带模块名：否则 Turndown 就绪（只服务下一次粘贴）也会
 * 触发一次整份 range index 重建，纯属白烧 CPU。
 *
 * **判断是否要刷新直接读视图状态，不做跨层记账**：页面上可能同时存在多个
 * 编辑器（官网 live editor、任何多实例宿主），跨层记账很容易两边身份对不上
 * （记账用 `EditorState`、消费用 controller 就永远对不上），也会让
 * `EditorState` 被模块级集合长期持有。读本视图自己的索引天然按实例隔离。
 */

import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
} from "../../markdown/range-index.ts";
import {
  onOptionalModuleReady,
  preloadOptionalModules,
  type OptionalModuleKey,
} from "../../module-loader.ts";
import { refreshWysiwygProjectionEffect } from "../../wysiwyg/state/types.ts";
import type { RendererViewAdapter } from "../types.ts";

/** 本视图是否还有 HTML 块停在"消毒器未就绪"的占位。 */
function hasPendingHtmlBlocks(view: RendererViewAdapter): boolean {
  const index = view.state.field(markdownRangeIndexField, false);
  if (!index) return false;
  // HTML 记录的 `parserCoverage` 是 complete（语法解析没问题），占位来自
  // **消毒器**缺失 —— 只看 coverage 会漏掉这一类（实测踩过）。
  return index.records.some((record) => record.kind === "html");
}

/** 本视图是否还有 MDX 块停在 `parserCoverage=partial`。 */
function hasPendingMdxBlocks(view: RendererViewAdapter): boolean {
  const index = view.state.field(markdownRangeIndexField, false);
  if (!index) return false;
  return index.records.some((record) => record.parserCoverage !== "complete");
}

/**
 * 按模块名刷新某个视图的投影（纯路由，不含订阅与预加载）。
 *
 * 抽成独立函数是为了可测：订阅器里内联这段路由的话，测试只能连带触发
 * `preloadOptionalModules()` 的全量预加载，"Turndown 不该派发事务"这类
 * 断言会被其它模块的就绪通知污染，从而失去判别力。
 *
 * @returns 是否派发了事务。
 */
export function refreshOptionalModuleProjection(
  view: RendererViewAdapter,
  key: OptionalModuleKey,
): boolean {
  // Turndown 只服务下一次粘贴，就绪本身不需要任何重算。
  if (key === "turndown") return false;

  if (key === "sanitize-html") {
    // 消毒器只影响 HTML 块投影：不重建解析索引。
    if (!hasPendingHtmlBlocks(view)) return false;
    view.dispatch({ effects: refreshWysiwygProjectionEffect.of(null) });
    return true;
  }

  // MDX 解析器影响解析索引（以及依赖它的投影）。
  if (!hasPendingMdxBlocks(view)) return false;
  view.dispatch({
    effects: [refreshWysiwygProjectionEffect.of(null), refreshMarkdownParseCoverageEffect.of(null)],
  });
  return true;
}

/**
 * 启动预加载并订阅就绪事件（**每个渲染器各调一次**）。
 *
 * @param getView 惰性取视图（控制器字段初始化早于视图构建，故用 getter）。
 * @returns 退订函数。
 */
export function attachOptionalModuleRefresh(
  getView: () => RendererViewAdapter | null | undefined,
): () => void {
  void preloadOptionalModules().catch(() => undefined);
  return onOptionalModuleReady((key) => {
    const view = getView();
    if (!view) return;
    refreshOptionalModuleProjection(view, key);
  });
}
