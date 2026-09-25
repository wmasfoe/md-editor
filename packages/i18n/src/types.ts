export type Locale = "zh" | "en" | "zh-Hant" | "ja";

export type LanguageSetting = "system" | Locale;

export interface LocaleInfo {
  readonly code: Locale;
  readonly label: string;
  readonly shortLabel: string;
}

export const SUPPORTED_LOCALES: readonly LocaleInfo[] = [
  { code: "en", label: "English", shortLabel: "EN" },
  { code: "zh", label: "简体中文", shortLabel: "中" },
  { code: "zh-Hant", label: "繁體中文", shortLabel: "繁" },
  { code: "ja", label: "日本語", shortLabel: "日" },
] as const;

export const DEFAULT_LOCALE: Locale = "zh";
export const FALLBACK_LOCALE: Locale = "en";
