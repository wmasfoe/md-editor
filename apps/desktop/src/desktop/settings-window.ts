import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isSettingsWindowSurface, resolveDesktopWindowSurface } from "./window-labels";

export { SETTINGS_WINDOW_LABEL } from "./window-labels";

export function isSettingsWindow(): boolean {
  return isSettingsWindowSurface(resolveDesktopWindowSurface());
}

export async function openSettingsWindow(): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  // 设置窗口由 Rust 侧创建单例，避免主窗口和设置窗口各自竞态创建重复窗口。
  await invoke("open_settings_window");
  return true;
}

export async function revealCurrentSettingsWindow(): Promise<boolean> {
  if (!isSettingsWindow() || !isTauri()) {
    return false;
  }

  const window = getCurrentWindow();
  // 主题变量和自定义 style 已同步写入；强制完成样式计算后再让原生窗口产生首帧。
  void document.documentElement.offsetWidth;
  await window.show();
  await window.setFocus();
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

export async function destroyCurrentSettingsWindow(): Promise<boolean> {
  if (!isSettingsWindow() || !isTauri()) {
    return false;
  }

  // 原生关闭事件里已经 preventDefault；这里直接销毁，避免再次触发 close-requested 形成关闭循环。
  await getCurrentWindow().destroy();
  return true;
}
