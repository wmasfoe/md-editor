// apps/utools/src/utools/lifecycle.ts
// uTools 插件统一生命周期监听与路由分发

export interface PluginEnterDetail {
  code: string;
  type: "text" | "img" | "file" | "regex" | "over" | "window";
  payload: unknown;
  from: "main" | "panel" | "hotkey" | "reirect";
}

export type PluginEnterHandler = (detail: PluginEnterDetail) => void;
export type PluginOutHandler = (isKill: boolean) => void;
export type PluginDetachHandler = () => void;

/**
 * 安装并注册 uTools 顶层事件监听器
 */
export function registerUtoolsLifecycle(handlers: {
  onEnter: PluginEnterHandler;
  onOut?: PluginOutHandler;
  onDetach?: PluginDetachHandler;
}): () => void {
  if (typeof window === "undefined" || !window.utools) {
    return () => {};
  }

  // 1. 进入插件
  window.utools.onPluginEnter((action) => {
    handlers.onEnter(action as PluginEnterDetail);
  });

  // 2. 退出插件
  if (handlers.onOut) {
    window.utools.onPluginOut((isKill) => {
      handlers.onOut?.(isKill);
    });
  }

  // 3. 分离为独立浮动窗口
  if (handlers.onDetach) {
    window.utools.onPluginDetach(() => {
      handlers.onDetach?.();
    });
  }

  return () => {
    // uTools API 未提供显式卸载方法，此处返回空清理函数
  };
}
