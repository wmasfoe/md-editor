import i18n, {
  use as i18nUse,
  changeLanguage as i18nChangeLanguage,
  t as i18nT,
  type i18n as I18nInstance,
} from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { zh } from "./locales/zh";
import { zhHant } from "./locales/zh-Hant";
import { ja } from "./locales/ja";
import { detectSystemLocale, resolveActiveLocale } from "./detect";
import type { LanguageSetting, Locale } from "./types";
import { FALLBACK_LOCALE } from "./types";

export const resources = {
  zh: {
    translation: zh,
  },
  "zh-Hant": {
    translation: zhHant,
  },
  en: {
    translation: en,
  },
  ja: {
    translation: ja,
  },
} as const;

let isInitialized = false;

export function ensureI18nInitialized(initialLocale?: LanguageSetting): I18nInstance {
  if (!isInitialized) {
    const activeLocale = resolveActiveLocale(initialLocale ?? detectSystemLocale());
    void i18nUse(initReactI18next).init({
      resources,
      lng: activeLocale,
      fallbackLng: FALLBACK_LOCALE,
      interpolation: {
        escapeValue: false, // React 已自带 XSS 转义
      },
      react: {
        useSuspense: false,
      },
    });
    isInitialized = true;
  }
  return i18n;
}

// 默认直接初始化以供模块引入时即用
ensureI18nInitialized();

export async function changeLanguage(localeOrSetting: LanguageSetting): Promise<void> {
  const activeLocale = resolveActiveLocale(localeOrSetting);
  await i18nChangeLanguage(activeLocale);
  if (typeof document !== "undefined") {
    document.documentElement.lang =
      activeLocale === "zh"
        ? "zh-CN"
        : activeLocale === "zh-Hant"
          ? "zh-TW"
          : activeLocale === "ja"
            ? "ja"
            : "en";
  }
}

export function getCurrentLocale(): Locale {
  const current = i18n.language;
  if (current === "zh" || current === "zh-Hant" || current === "ja" || current === "en") {
    return current;
  }
  return "en";
}

export { i18n };
export const t = i18nT;
