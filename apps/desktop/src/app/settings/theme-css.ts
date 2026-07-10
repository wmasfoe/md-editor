import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppThemeSettings, ThemeSchemeSettings } from "./app-settings";
import { resolveThemeColorScheme } from "./app-settings";
import { builtInThemeCss } from "./built-in-themes";

export interface ThemeCssFile {
  readonly path: string;
  readonly css: string;
}

const themeCssCache = new Map<string, string>();

export async function pickThemeCssFile(): Promise<ThemeCssFile | null> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持选择本地 CSS 文件，请在桌面端使用。");
  }
  return invoke<ThemeCssFile | null>("pick_theme_css_file");
}

export async function readThemeCssFile(path: string): Promise<ThemeCssFile> {
  if (!isTauri()) {
    throw new Error("Web 预览不支持读取本地 CSS 文件，请在桌面端使用。");
  }
  return invoke<ThemeCssFile>("read_theme_css_file", { path });
}

export function rememberThemeCssFile(file: ThemeCssFile) {
  themeCssCache.set(file.path, file.css);
}

export function applyCustomThemeCss(
  theme: AppThemeSettings,
  options: {
    readonly loadCss?: (path: string) => Promise<ThemeCssFile>;
    readonly target?: HTMLElement;
  } = {},
): () => void {
  const target = options.target ?? document.documentElement;
  const loadCss = options.loadCss ?? readThemeCssFile;
  let disposed = false;
  let requestId = 0;

  const applyResolvedCss = () => {
    const scheme = resolveThemeColorScheme(theme.mode);
    const themeScheme = scheme === "dark" ? theme.dark : theme.light;
    const cssPath = customCssPathForThemeScheme(themeScheme);
    const fallbackCss = builtInThemeCss(themeScheme.builtinTheme);
    const currentRequest = (requestId += 1);

    target.dataset.themeScheme = scheme;
    target.dataset.themeSource = themeScheme.source;
    target.dataset.themeBuiltin = themeScheme.builtinTheme;
    target.dataset.themeCssPath = cssPath ?? "";

    if (!cssPath) {
      setThemeStyleText(fallbackCss);
      return;
    }

    const cachedCss = themeCssCache.get(cssPath);
    if (cachedCss !== undefined) {
      setThemeStyleText(cachedCss);
    } else {
      setThemeStyleText(fallbackCss);
    }

    void loadCss(cssPath)
      .then((file) => {
        if (!disposed && currentRequest === requestId) {
          rememberThemeCssFile(file);
          setThemeStyleText(file.css);
        }
      })
      .catch((error: unknown) => {
        if (!disposed && currentRequest === requestId) {
          setThemeStyleText(fallbackCss);
          console.warn("主题 CSS 加载失败", error);
        }
      });
  };

  applyResolvedCss();

  if (theme.mode !== "system" || typeof window.matchMedia !== "function") {
    return () => {
      disposed = true;
    };
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", applyResolvedCss);
  return () => {
    disposed = true;
    mediaQuery.removeEventListener("change", applyResolvedCss);
  };
}

function customCssPathForThemeScheme(theme: ThemeSchemeSettings): string | null {
  return theme.source === "custom" ? theme.customCssPath : null;
}

function setThemeStyleText(css: string) {
  let style = document.getElementById("md-editor-custom-theme") as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = "md-editor-custom-theme";
    document.head.append(style);
  }
  if (style.textContent === css) {
    return;
  }
  style.textContent = css;
}
