import { useCallback, useEffect, useRef, useState } from "react";
import { compileThemeCss, setThemeStyleText } from "@md-editor/editor-ui";
import { loadUtoolsSettings, saveUtoolsSettings, type UtoolsSettings } from "./db-storage";
import { applyResolvedUtoolsTheme, resolveUtoolsTheme } from "./theme";

export function useUtoolsThemeSettings() {
  const [settings, setSettings] = useState<UtoolsSettings>(() => loadUtoolsSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsBeforeDialogRef = useRef(settings);

  const handleUpdateSettings = useCallback(
    (updater: Partial<UtoolsSettings> | ((prev: UtoolsSettings) => UtoolsSettings)) => {
      setSettings((prev) => {
        return typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      });
    },
    [],
  );

  const handleOpenSettings = useCallback(() => {
    settingsBeforeDialogRef.current = settingsRef.current;
    setIsSettingsOpen(true);
  }, []);

  const handleCancelSettings = useCallback(() => {
    setSettings(settingsBeforeDialogRef.current);
    setIsSettingsOpen(false);
  }, []);

  const handleSaveSettings = useCallback(() => {
    const next = settingsRef.current;
    saveUtoolsSettings(next);
    settingsBeforeDialogRef.current = next;
    setIsSettingsOpen(false);
  }, []);

  const applyTheme = useCallback((themeMode: "system" | "light" | "dark") => {
    let isDark = false;
    if (themeMode === "dark") {
      isDark = true;
    } else if (themeMode === "light") {
      isDark = false;
    } else {
      if (typeof window !== "undefined" && window.utools?.isDarkColors) {
        isDark = window.utools.isDarkColors();
      } else if (typeof window !== "undefined") {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
    }

    const resolved = resolveUtoolsTheme(themeMode, isDark);
    if (typeof document !== "undefined") {
      applyResolvedUtoolsTheme(document.documentElement, resolved);
    }

    const activeThemeId =
      resolved === "dark"
        ? (settingsRef.current.darkTheme ?? "charcoal-dark")
        : (settingsRef.current.lightTheme ?? "paper-light");

    const compiledCss = compileThemeCss({
      baseTheme: activeThemeId,
      colorScheme: resolved,
      typographyOverrides: {
        proseFontFamily: settingsRef.current.proseFontFamily || undefined,
        codeFontFamily: settingsRef.current.codeFontFamily || undefined,
        fontSize: settingsRef.current.fontSize || undefined,
      },
    });

    setThemeStyleText(compiledCss);
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);

    if (settings.theme === "system" && typeof window !== "undefined") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme("system");
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
  }, [applyTheme, settings.theme, settings.lightTheme, settings.darkTheme]);

  return {
    settings,
    settingsRef,
    isSettingsOpen,
    applyTheme,
    handleOpenSettings,
    handleCancelSettings,
    handleSaveSettings,
    handleUpdateSettings,
  };
}
