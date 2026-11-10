import i18n, { use as i18nUse, t as i18nT, type i18n as I18nInstance } from "i18next";
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

/**
 * 宿主可配置项。
 *
 * 本模块**不在导入时执行任何副作用**：不再于模块顶层调用 `ensureI18nInitialized()`。
 * 原因：任何 `import "@md-editor/i18n"` 的代码（包括只用一个编辑器组件的外部宿主）
 * 都会无条件拉入 i18next + react-i18next + 四份语言包，并悄悄改写宿主的
 * `document.documentElement.lang`。库不该在 import 时改动宿主环境。
 *
 * 初始化改为**惰性**：首次调用 `useTranslation` / `changeLanguage` / `ensureI18nInitialized`
 * 时才初始化一次（幂等）。宿主若想用自己的 i18n 实例，调用 `configureI18n({ instance })`
 * 即可完全接管。
 */
export interface I18nConfiguration {
  /**
   * 是否让 `changeLanguage` 同步改写 `document.documentElement.lang`。
   *
   * 默认 `false`：库代码不应单方面修改宿主文档的全局属性。
   * 需要该行为的宿主（本仓库的 desktop / web 应用，其 Markdown lint 文案按
   * `documentElement.lang` 选择语言）应在启动时显式开启。
   */
  readonly syncDocumentLang?: boolean;
  /**
   * 宿主自有的 i18n 实例。提供后本包不再初始化自己的实例，
   * `useTranslation` / `changeLanguage` 全部代理到它。
   */
  readonly instance?: I18nInstance;
}

let configuration: I18nConfiguration = {};

/**
 * 配置本包的 i18n 行为。可在应用启动时调用一次；重复调用以最后一次为准。
 *
 * 不调用时保持默认行为：惰性初始化自带实例，且不改写 `documentElement.lang`。
 */
export function configureI18n(next: I18nConfiguration): void {
  configuration = { ...configuration, ...next };
  if (next.instance) {
    // 让 react-i18next 认这个实例：`useTranslation` 内部走 `getI18n()`，
    // 只有 `initReactI18next.init()` 会把它登记为默认实例；否则组件会渲染出原始 key。
    // 同时用 `i18n.use()` 让实例完成 3rdParty 初始化。
    // `use()` 会把插件排进 i18next 的异步初始化队列，未必立刻生效；
    // 直接调用插件的 `init` 才能保证同步登记（这正是 `use()` 最终做的事）。
    initReactI18next.init(next.instance);
    isInitialized = true;
  }
}

/** 当前生效的 i18n 实例（宿主注入的优先，否则为本包自带实例）。 */
function activeInstance(): I18nInstance {
  return configuration.instance ?? i18n;
}

export function ensureI18nInitialized(initialLocale?: LanguageSetting): I18nInstance {
  // 宿主接管时不再初始化自己的实例。
  if (configuration.instance) {
    return configuration.instance;
  }
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

/** 把语言设置映射为 `<html lang>` 的取值。 */
function toHtmlLang(locale: Locale): string {
  switch (locale) {
    case "zh":
      return "zh-CN";
    case "zh-Hant":
      return "zh-TW";
    case "ja":
      return "ja";
    case "en":
    default:
      return "en";
  }
}

export async function changeLanguage(localeOrSetting: LanguageSetting): Promise<void> {
  // 惰性初始化：保证裸调 `changeLanguage`（如测试或宿主启动脚本）也能正常工作。
  ensureI18nInitialized();
  const activeLocale = resolveActiveLocale(localeOrSetting);
  // 必须走 activeInstance()：宿主用 configureI18n({ instance }) 接管后，
  // 切换语言要作用在**它**的实例上，而不是本包自带的模块级实例。
  await activeInstance().changeLanguage(activeLocale);

  // 只有显式开启时才改写宿主文档的全局属性（见 I18nConfiguration.syncDocumentLang）。
  if (configuration.syncDocumentLang === true && typeof document !== "undefined") {
    document.documentElement.lang = toHtmlLang(activeLocale);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("md-editor:language-changed", { detail: { locale: activeLocale } }),
    );
  }
}

export function getCurrentLocale(): Locale {
  const current = activeInstance().language;
  if (current === "zh" || current === "zh-Hant" || current === "ja" || current === "en") {
    return current;
  }
  return "en";
}

export { i18n };

/**
 * 直接翻译函数。
 *
 * 包装一层而非直接导出 `i18nT`：这样首次调用会惰性初始化，
 * 避免"导入后直接 `t(...)` 得到原始 key"。
 */
export function t(...args: unknown[]): string {
  ensureI18nInitialized();
  const instance = activeInstance();
  // 注入实例时用它自己的 `t`，否则用模块级绑定（性能更好、类型更准）。
  const translate =
    instance === i18n
      ? (i18nT as unknown as (...a: unknown[]) => string)
      : (instance.t.bind(instance) as unknown as (...a: unknown[]) => string);
  return translate(...args);
}

/** `t` 的对外类型与 i18next 的 `t` 保持一致（含全部重载）。 */
export type TranslateFunction = typeof i18nT;
