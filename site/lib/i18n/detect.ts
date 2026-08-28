import {
  CHINESE_LOCALE,
  DEFAULT_NON_CHINESE_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "./types";

export const STORAGE_KEY_LOCALE = "inkpoint_locale";

/**
 * 校验值是否为受支持的 Locale
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * 解析 Accept-Language 请求头，计算最佳匹配语言。
 * 规则：默认取浏览器语言，只要浏览器第一偏好或主语言不是中文（zh 开头），一律回退为英文（en）。
 *
 * @param acceptLanguage HTTP Accept-Language 请求头字符串
 * @returns 'zh' | 'en'
 */
export function detectLocaleFromHeader(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage || typeof acceptLanguage !== "string") {
    return DEFAULT_NON_CHINESE_LOCALE;
  }

  // 解析 Accept-Language，例如: "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7"
  const parsed = acceptLanguage
    .split(",")
    .map((part) => {
      const [lang, qPart] = part.trim().split(";");
      let q = 1.0;
      if (qPart) {
        const match = qPart.trim().match(/^q=([0-9.]+)$/);
        if (match) {
          const parsedQ = parseFloat(match[1]);
          if (!isNaN(parsedQ)) {
            q = parsedQ;
          }
        }
      }
      return { lang: lang.trim().toLowerCase(), q };
    })
    .filter((item) => item.lang.length > 0 && item.q > 0)
    .sort((a, b) => b.q - a.q);

  if (parsed.length === 0) {
    return DEFAULT_NON_CHINESE_LOCALE;
  }

  // 获取优先级最高的首选语言
  const topLanguage = parsed[0].lang;

  // 只要首选语言是中文相关（zh, zh-cn, zh-tw, zh-hk 等），展示中文；其余全部展示英文
  if (topLanguage.startsWith("zh")) {
    return CHINESE_LOCALE;
  }

  return DEFAULT_NON_CHINESE_LOCALE;
}

/**
 * 客户端环境下的语言探测逻辑：
 * 1. 优先读取用户在 localStorage 中手动持久化的语言偏好；
 * 2. 若未手动设置过，则读取浏览器 navigator.language / navigator.languages；
 * 3. 浏览器语言非中文时，一律默认使用英文。
 */
export function detectClientLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_NON_CHINESE_LOCALE;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY_LOCALE);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // 忽略 localStorage 访问异常（例如隐身模式安全限制）
  }

  const navLanguages: readonly string[] =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];

  if (navLanguages.length > 0) {
    const primary = navLanguages[0].toLowerCase();
    if (primary.startsWith("zh")) {
      return CHINESE_LOCALE;
    }
  }

  return DEFAULT_NON_CHINESE_LOCALE;
}
