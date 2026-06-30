import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const SETTINGS_WINDOW_LABEL = "settings";

export function isSettingsWindow(): boolean {
  // Tauri 的 window label 是设置窗口的权威判断；query 参数只用于 Vite/Web 预览兜底。
  if (isTauri()) {
    return getCurrentWindow().label === SETTINGS_WINDOW_LABEL;
  }

  return new URLSearchParams(window.location.search).get("window") === SETTINGS_WINDOW_LABEL;
}

export async function openSettingsWindow(): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  // 设置窗口由 Rust 侧创建单例，避免主窗口和设置窗口各自竞态创建重复窗口。
  await invoke("open_settings_window");
  return true;
}

export async function closeCurrentSettingsWindow(): Promise<boolean> {
  if (!isSettingsWindow() || !isTauri()) {
    return false;
  }

  // 只允许设置窗口关闭自己；关闭动作交给 Rust，避免前端 Window.close 权限或上下文差异报错。
  await invoke("close_settings_window");
  return true;
}
