import { builtInThemeCss, setThemeStyleText, type BuiltInThemeId } from "@md-editor/editor-ui";
import type { WebSettings } from "./web-settings";

export function resolveEffectiveColorScheme(theme: "light" | "dark" | "system"): "light" | "dark" {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function applyDesktopTheme(settings: WebSettings): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const apply = () => {
    const scheme = resolveEffectiveColorScheme(settings.theme);
    const themeId: BuiltInThemeId = scheme === "dark" ? settings.darkTheme : settings.lightTheme;
    const css = builtInThemeCss(themeId);

    // 注入桌面端一致的纯正 CSS 变量
    setThemeStyleText(css);

    const root = document.documentElement;
    root.dataset.themeScheme = scheme;
    root.dataset.themeBuiltin = themeId;

    if (scheme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
  };

  apply();

  if (settings.theme !== "system" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => apply();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
