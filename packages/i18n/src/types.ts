export type Locale = "zh" | "en";

export type LanguageSetting = "system" | Locale;

export interface LocaleInfo {
  readonly code: Locale;
  readonly label: string;
  readonly shortLabel: string;
}

export const SUPPORTED_LOCALES: readonly LocaleInfo[] = [
  { code: "zh", label: "简体中文", shortLabel: "中" },
  { code: "en", label: "English", shortLabel: "EN" },
] as const;

export const DEFAULT_LOCALE: Locale = "zh";
export const FALLBACK_LOCALE: Locale = "zh";
