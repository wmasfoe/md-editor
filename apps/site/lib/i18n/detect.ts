import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "./types";

export const STORAGE_KEY_LOCALE = "inkpoint_locale";

/**
 * 校验值是否为受支持的 Locale
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * 将任意语言代码匹配到受支持的 Locale：
 * - 繁体中文 (zh-TW, zh-HK, zh-MO, zh-Hant 等) -> "zh-Hant"
 * - 简体中文 (zh-CN, zh-SG, zh-Hans, zh 等) -> "zh"
 * - 日语 (ja, ja-JP 等) -> "ja"
 * - 英语 (en, en-US, en-GB 等) -> "en"
 * - 未支持语言 -> null
 */
export function matchLocale(languageCode: string): Locale | null {
  const lower = languageCode.trim().toLowerCase();
  if (
    lower.startsWith("zh-tw") ||
    lower.startsWith("zh-hk") ||
    lower.startsWith("zh-mo") ||
    lower.startsWith("zh-hant")
  ) {
    return "zh-Hant";
  }
  if (lower.startsWith("zh")) {
    return "zh";
  }
  if (lower.startsWith("ja")) {
    return "ja";
  }
  if (lower.startsWith("en")) {
    return "en";
  }
  return null;
}

/**
 * 解析 Accept-Language 请求头，计算最佳匹配语言。
 * 规则：根据用户的浏览器设置的默认语言，如果我们还不支持，那就默认用英文。
 *
 * @param acceptLanguage HTTP Accept-Language 请求头字符串
 * @returns Locale
 */
export function detectLocaleFromHeader(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage || typeof acceptLanguage !== "string") {
    return DEFAULT_LOCALE;
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
    .toSorted((a, b) => b.q - a.q);

  if (parsed.length === 0) {
    return DEFAULT_LOCALE;
  }

  // 获取优先级最高的首选语言；若首选语言未被我们支持，默认回退至英文
  const topLanguage = parsed[0].lang;
  const topMatched = matchLocale(topLanguage);
  if (topMatched) {
    return topMatched;
  }

  return DEFAULT_LOCALE;
}

/**
 * 客户端环境下的语言探测逻辑：
 * 1. 优先读取用户在 localStorage 中手动持久化的语言偏好；
 * 2. 若未手动设置过，则读取浏览器 navigator.languages / navigator.language；
 * 3. 若浏览器设置的语言我们还不支持，那就默认用英文。
 */
export function detectClientLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
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
    const primary = navLanguages[0];
    const matched = matchLocale(primary);
    if (matched) {
      return matched;
    }
  }

  return DEFAULT_LOCALE;
}
