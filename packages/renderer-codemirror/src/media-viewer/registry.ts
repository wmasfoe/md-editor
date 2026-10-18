/**
 * @file registry.ts
 * @description 媒体查看器的**宿主键控登记表**——浮层生命周期所有权的唯一来源。
 *
 * 为什么必须按 **host DOM** 键控（而不是 widget 实例字段）：
 * CM6 在 `WidgetType.compare()` 为真时走 DOM 复用分支（`Reused.DOM`）并**丢弃旧 widget 实例**，
 * 旧实例的 `destroy` 不会被调用（`WidgetTile.destroy` 用的是 tile 当前实例）⇒ 实例字段持有的句柄
 * 必然泄漏出"幽灵浮层"与 `document` 级键盘监听。
 *
 * 为什么单独成模块：这段逻辑是本能力里最容易出错的部分（重复 open、跨 host 误关、销毁期竞态），
 * 而它完全不依赖 DOM 实现，抽出来后可在 node 环境直测——不必靠浏览器盲测。
 */

/** 可登记的句柄形状（只要求能关闭）。 */
export interface ViewerHandleLike {
  close(options?: { readonly restoreFocus?: boolean }): void;
}

export interface MediaViewerRegistry<THandle extends ViewerHandleLike> {
  /**
   * 关闭并注销该 host 名下的句柄。
   * @returns 是否确实关闭了句柄（未登记时为 `false`，即**幂等 no-op**）。
   */
  closeFor(host: object, options?: { readonly restoreFocus?: boolean }): boolean;
  /** 登记句柄（调用方负责在此之前关闭旧句柄，见 `openSequence`）。 */
  set(host: object, handle: THandle): void;
  has(host: object): boolean;
  /** 仅注销登记（句柄已在别处关闭时使用，避免重复 close）。 */
  forget(host: object): void;
  /**
   * 推荐的开启序列：**先关旧、再建新**。
   * 顺序不可颠倒——若先建新再关旧，同一 host 名下会短暂存在两个浮层（两个 `document` 级监听）。
   */
  replace(host: object, create: () => THandle): THandle;
}

export function createMediaViewerRegistry<
  THandle extends ViewerHandleLike,
>(): MediaViewerRegistry<THandle> {
  const byHost = new WeakMap<object, THandle>();
  return {
    closeFor(host, options) {
      const existing = byHost.get(host);
      if (!existing) {
        return false;
      }
      byHost.delete(host);
      existing.close(options ?? { restoreFocus: false });
      return true;
    },
    set(host, handle) {
      byHost.set(host, handle);
    },
    has(host) {
      return byHost.has(host);
    },
    forget(host) {
      byHost.delete(host);
    },
    replace(host, create) {
      // 重复 open 守卫：同 host 已有句柄时先关旧（含其 document 级监听与浮层 DOM）
      const existing = byHost.get(host);
      if (existing) {
        byHost.delete(host);
        existing.close({ restoreFocus: false });
      }
      const handle = create();
      byHost.set(host, handle);
      return handle;
    },
  };
}
