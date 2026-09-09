import type { zh } from "./locales/zh";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof zh;
    };
  }
}

export { useTranslation, Trans, I18nextProvider } from "react-i18next";
export {
  i18n,
  t,
  changeLanguage,
  getCurrentLocale,
  ensureI18nInitialized,
  resources,
} from "./i18n";
export { detectSystemLocale, resolveActiveLocale } from "./detect";
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  type Locale,
  type LanguageSetting,
  type LocaleInfo,
} from "./types";
export { zh, type TranslationSchema } from "./locales/zh";
export { en } from "./locales/en";
