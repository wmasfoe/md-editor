import { createInstance, type i18n as I18nInstance } from "i18next";
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

export interface I18nConfiguration {
  /** Explicit host opt-in; independent scopes leave document globals alone by default. */
  readonly syncDocumentLang?: boolean;
  readonly instance?: I18nInstance;
}

function toHtmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : locale === "zh-Hant" ? "zh-TW" : locale;
}

/**
 * A host owns its translation state. Initialize before rendering an I18nextProvider
 * with scope.instance; this never registers a react-i18next global default.
 */
export interface I18nScope {
  readonly instance: I18nInstance;
  configure(next: I18nConfiguration): void;
  ensureI18nInitialized(initialLocale?: LanguageSetting): I18nInstance;
  getCurrentLocale(): Locale;
  t(...args: unknown[]): string;
  changeLanguage(setting: LanguageSetting): Promise<void>;
}

export function createI18nScope(initial: I18nConfiguration = {}): I18nScope {
  const ownInstance = createInstance();
  let configuration = { ...initial };
  const activeInstance = () => configuration.instance ?? ownInstance;
  function ensureInitialized(initialLocale?: LanguageSetting): I18nInstance {
    const instance = activeInstance();
    if (!instance.isInitialized && !configuration.instance) {
      // Bundled synchronous resources allow translation on the first call.
      void instance.init({
        resources,
        lng: resolveActiveLocale(initialLocale ?? detectSystemLocale()),
        fallbackLng: FALLBACK_LOCALE,
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
      });
    }
    return instance;
  }
  return {
    get instance() {
      return activeInstance();
    },
    configure(next: I18nConfiguration) {
      configuration = { ...configuration, ...next };
    },
    ensureI18nInitialized: ensureInitialized,
    getCurrentLocale(): Locale {
      const language = activeInstance().language;
      return language === "zh" || language === "zh-Hant" || language === "ja" ? language : "en";
    },
    t(...args: unknown[]): string {
      const instance = ensureInitialized();
      return (instance.t as unknown as (...a: unknown[]) => string)(...args);
    },
    async changeLanguage(setting: LanguageSetting): Promise<void> {
      const instance = ensureInitialized();
      const locale = resolveActiveLocale(setting);
      await instance.changeLanguage(locale);
      if (configuration.syncDocumentLang && typeof document !== "undefined") {
        document.documentElement.lang = toHtmlLang(locale);
      }
    },
  };
}

// The application facade has one explicitly shared scope. Embedded hosts create
// their own scopes instead of configuring this application default.
const defaultScope = createI18nScope();
export function configureI18n(next: I18nConfiguration): void {
  defaultScope.configure(next);
  if ("instance" in next && (next.instance || defaultScope.instance.isInitialized)) {
    initReactI18next.init(defaultScope.instance);
  }
}
export function ensureI18nInitialized(initialLocale?: LanguageSetting): I18nInstance {
  const instance = defaultScope.ensureI18nInitialized(initialLocale);
  initReactI18next.init(instance);
  return instance;
}
export function t(...args: unknown[]): string {
  ensureI18nInitialized();
  return defaultScope.t(...args);
}
export const getCurrentLocale = defaultScope.getCurrentLocale;
export async function changeLanguage(locale: LanguageSetting): Promise<void> {
  ensureI18nInitialized();
  await defaultScope.changeLanguage(locale);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("md-editor:language-changed", {
        detail: { locale: defaultScope.getCurrentLocale() },
      }),
    );
  }
}
export const i18n: I18nInstance = defaultScope.instance;
export type TranslateFunction = typeof i18n.t;
