import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const MAIN_WINDOW_LABEL = "main";
export const SETTINGS_WINDOW_LABEL = "settings";

export type DesktopWindowSurface =
  | typeof MAIN_WINDOW_LABEL
  | typeof SETTINGS_WINDOW_LABEL
  | { readonly kind: "unknown"; readonly label: string };

export function resolveDesktopWindowSurface(search = window.location.search): DesktopWindowSurface {
  const label = isTauri()
    ? getCurrentWindow().label
    : (new URLSearchParams(search).get("window") ?? MAIN_WINDOW_LABEL);

  if (label === MAIN_WINDOW_LABEL || label === SETTINGS_WINDOW_LABEL) {
    return label;
  }

  return Object.freeze({ kind: "unknown" as const, label });
}

export function isSettingsWindowSurface(
  surface: DesktopWindowSurface = resolveDesktopWindowSurface(),
): boolean {
  return surface === SETTINGS_WINDOW_LABEL;
}
