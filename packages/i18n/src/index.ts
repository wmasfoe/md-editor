import type { zh } from "./locales/zh";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof zh;
    };
  }
}

import {
  useTranslation as useReactI18nextTranslation,
  type UseTranslationOptions,
  type UseTranslationResponse,
} from "react-i18next";

import { ensureI18nInitialized } from "./i18n";

/**
 * 惰性初始化的 `useTranslation`。
 *
 * react-i18next 的 `useTranslation` 不会初始化 i18next 实例——它假定宿主已经 init。
 * 本包不再在模块顶层自动 init（库不应在 import 时产生副作用），因此这里包一层：
 * 首次渲染时确保实例已就绪，避免组件拿到未初始化实例后渲染出原始 key。
 *
 * 宿主用 `configureI18n({ instance })` 接管后，本包装层不做任何额外工作。
 */
export function useTranslation(
  namespace?: Parameters<typeof useReactI18nextTranslation>[0],
  options?: UseTranslationOptions<undefined>,
): UseTranslationResponse<"translation", undefined> {
  ensureI18nInitialized();
  return useReactI18nextTranslation(namespace, options);
}

export { Trans, I18nextProvider } from "react-i18next";
export {
  i18n,
  t,
  changeLanguage,
  getCurrentLocale,
  ensureI18nInitialized,
  configureI18n,
  resources,
  type I18nConfiguration,
} from "./i18n";
export { detectSystemLocale, normalizeLanguageSetting, resolveActiveLocale } from "./detect";
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  type Locale,
  type LanguageSetting,
  type LocaleInfo,
} from "./types";
export { zh, type TranslationSchema } from "./locales/zh";
export { zhHant } from "./locales/zh-Hant";
export { en } from "./locales/en";
export { ja } from "./locales/ja";
