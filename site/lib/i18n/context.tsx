"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { detectClientLocale, STORAGE_KEY_LOCALE } from "./detect";
import { translations } from "./index";
import type { Locale, TranslationSchema } from "./types";

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TranslationSchema;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale: Locale;
  children: ReactNode;
}

export function I18nProvider({ initialLocale, children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // 客户端挂载后校准：检查 localStorage 中的历史设置或实际浏览器语言
  useEffect(() => {
    const clientLocale = detectClientLocale();
    setLocaleState((prev) => (prev !== clientLocale ? clientLocale : prev));
    document.documentElement.lang = clientLocale === "zh" ? "zh-CN" : "en";
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      localStorage.setItem(STORAGE_KEY_LOCALE, nextLocale);
    } catch {
      // 忽略 localStorage 写入异常
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
    }
  }, []);

  const t = translations[locale] ?? translations.en;

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

/**
 * 获取当前语言环境、翻译字典以及切换方法
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
