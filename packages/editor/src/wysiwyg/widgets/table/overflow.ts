/**
 * @file overflow.ts
 * @description 表格横向溢出状态检测（驱动 `data-table-overflow` 属性，供样式切换滚动/裁切策略）。
 *
 * 为什么需要运行时状态而不是纯 CSS：
 *
 * 表格的行/列手柄与行操作菜单挂在 widget 根节点（`.cm-md-table-widget`）上，并**故意溢出**
 * 到表格外侧（`left: -1.35rem` / `right: -0.65rem`，Notion 式块手柄）。
 *
 * - 若让根节点成为滚动容器，`overflow` 会把手柄与菜单裁掉（实测 `elementFromPoint` 落到
 *   `.cm-content`，手柄点不到）；
 * - 但 `overflow-x: auto` 即使**内容不溢出**也会建立裁剪盒，同样会裁掉外侧手柄。
 *
 * 纯 CSS 无法表达「只在溢出时才裁剪」，因此由本模块观测内层视口是否真的溢出，在根节点上写
 * `data-table-overflow="true|false"`，样式据此切换两套几何（见 `styles/table-css.ts`）：
 * 不溢出时 `overflow: visible` + 手柄贴外侧；溢出时 `overflow-x: auto` + 手柄移回内缘。
 */

/** 溢出状态属性名（样式与 E2E 断言共用）。 */
export const TABLE_OVERFLOW_ATTRIBUTE = "data-table-overflow";

const viewportSelector = ".cm-md-table-widget__viewport";

/** 测量并同步根节点的溢出状态，返回是否处于溢出态。 */
function syncOverflowState(wrapper: HTMLElement): boolean {
  const viewport = wrapper.querySelector<HTMLElement>(viewportSelector);
  const grid = wrapper.querySelector<HTMLElement>(".cm-md-table-widget__grid");
  if (!viewport || !grid) {
    return false;
  }
  // 不能用 viewport.scrollWidth：列宽拖动手柄（right: -3px）永远溢出表格 2px，
  // 会让每一张表（包括 2 列小表）都被误判为溢出。表格自身的布局宽度才是真正的溢出信号。
  // 取整比较：亚像素舍入（如 934.4 vs 934）会让表格在临界宽度反复抖动。
  const overflowing = Math.round(grid.offsetWidth) > Math.round(viewport.clientWidth) + 1;
  wrapper.setAttribute(TABLE_OVERFLOW_ATTRIBUTE, String(overflowing));
  return overflowing;
}

/**
 * 开始观测视口溢出状态。
 *
 * 需要观测的三类变化，缺一都会让状态陈旧：
 * 1. **容器宽度变化**（窗口缩放、侧栏折叠）—— 视口尺寸变但内容不变；
 * 2. **表格内容变化**（单元格文本、增删行列）—— 内容尺寸变但视口不变；
 * 3. **字体加载完成** —— 字宽变化会改变 min-content 宽度。
 *
 * 因此同时观测视口（尺寸）与表格（尺寸），并在字体就绪后补测一次。
 * 返回停止函数；`destroy()` 必须调用，否则 ResizeObserver 会随 widget 复用持续累积。
 */
export function observeTableOverflow(wrapper: HTMLElement): () => void {
  syncOverflowState(wrapper);

  const view = wrapper.ownerDocument?.defaultView;
  const ResizeObserverCtor = view?.ResizeObserver;
  if (!ResizeObserverCtor) {
    // 无 ResizeObserver 的环境（旧 WebView / Node 测试桩）：静态测量一次即可。
    return () => {};
  }

  const observer = new ResizeObserverCtor(() => {
    syncOverflowState(wrapper);
  });
  observer.observe(wrapper);
  const viewport = wrapper.querySelector<HTMLElement>(viewportSelector);
  if (viewport) {
    observer.observe(viewport);
  }
  const grid = wrapper.querySelector<HTMLElement>(".cm-md-table-widget__grid");
  if (grid) {
    observer.observe(grid);
  }

  // 字体晚于 widget 挂载就绪时，min-content 宽度会变；就绪后补测一次。
  void view?.document?.fonts?.ready?.then(() => {
    if (wrapper.isConnected) {
      syncOverflowState(wrapper);
    }
  });

  return () => observer.disconnect();
}

/** 手动触发一次重测（内容/行列变更后由 `updateDOM` 调用）。 */
export function refreshTableOverflow(wrapper: HTMLElement): void {
  syncOverflowState(wrapper);
}
