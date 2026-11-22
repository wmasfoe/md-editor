/**
 * @file optional-modules.ts
 * @description 可选重依赖的宿主接线：预加载 + 就绪后重算投影。
 *
 * 编辑器有三处同步渲染路径依赖较重的第三方包（HTML 消毒、MDX 解析、粘贴转换）。
 * 它们不在首屏静态图内：未就绪时投影层走既有降级路径（HTML 块占位 /
 * MDX 块 `parserCoverage=partial`），本模块负责在模块就绪后触发一次重算。
 *
 * **判断依据直接读视图状态，不依赖跨层记账**：页面上可能同时存在多个编辑器
 * （官网 live editor、任何多实例宿主）。用模块级布尔量记账时，第一个就绪的
 * 监听器清零后其余实例不再重算；用"投影层写、宿主读"的 scope 也容易两边身份
 * 不一致（记账用 `EditorState`、消费用 controller 就永远对不上）。
 * 这里改成：就绪时检查**本视图**的 range index 里是否真有未完成的解析，
 * 有则重算 —— 天然按视图隔离，且与记账实现解耦。
 */

import {
  markdownRangeIndexField,
  refreshMarkdownParseCoverageEffect,
} from "../../markdown/range-index.ts";
import { onOptionalModuleReady, preloadOptionalModules } from "../../module-loader.ts";
import { refreshWysiwygProjectionEffect } from "../../wysiwyg/state/types.ts";
import type { RendererViewAdapter } from "../types.ts";

/**
 * 本视图是否可能受可选模块影响。
 *
 * 两类都要算上，否则会漏：
 * 1. **MDX 块**：解析器缺失时 `parserCoverage !== "complete"`；
 * 2. **HTML 块**：记录本身是 `complete`（语法解析没问题），但**消毒器**缺失时
 *    投影层会渲染 "Loading HTML preview…" 占位 —— 只看 coverage 会漏掉这一类
 *    （实测正是这个漏判让 HTML 块永久停在占位）。
 *
 * 该判断按视图读取自己的 range index，天然按实例隔离；没有 HTML/MDX 的文档
 * 不会命中，因此不会凭空多派事务打断编辑。
 */
function hasPendingOptionalWork(view: RendererViewAdapter): boolean {
  const index = view.state.field(markdownRangeIndexField, false);
  if (!index) return false;
  return index.records.some(
    (record) => record.kind === "html" || record.parserCoverage !== "complete",
  );
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
  return onOptionalModuleReady(() => {
    const view = getView();
    if (!view) return;
    if (!hasPendingOptionalWork(view)) return;
    view.dispatch({
      effects: [
        refreshWysiwygProjectionEffect.of(null),
        refreshMarkdownParseCoverageEffect.of(null),
      ],
    });
  });
}
