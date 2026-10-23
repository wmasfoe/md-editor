import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ABOUT_WINDOW_LABEL, resolveDesktopWindowSurface } from "./window-labels";

export function isAboutWindow(): boolean {
  return resolveDesktopWindowSurface() === ABOUT_WINDOW_LABEL;
}

/**
 * 打开（或聚焦）关于窗口。
 * 窗口由 Rust 侧以单例方式创建：菜单项、命令面板与设置入口共用同一条路径，
 * 不会出现两个「关于」窗口，也不会与原生 NSAboutPanel 重复。
 */
export async function openAboutWindow(): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  await invoke("open_about_window");
  return true;
}

/**
 * 关于窗口的首次显示：主题已写入后再让原生窗口产生首帧，避免白屏闪烁。
 */
export async function revealCurrentAboutWindow(): Promise<boolean> {
  if (!isAboutWindow() || !isTauri()) {
    return false;
  }

  const window = getCurrentWindow();
  // 强制完成一次样式计算，确保主题变量在显示前已经生效。
  void document.documentElement.offsetWidth;
  await window.show();
  await window.setFocus();
  return true;
}
