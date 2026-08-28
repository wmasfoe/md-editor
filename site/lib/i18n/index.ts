import { en } from "./translations/en";
import { zh } from "./translations/zh";
import type { Locale, TranslationSchema } from "./types";

export * from "./detect";
export * from "./types";
export { en, zh };

export const translations: Record<Locale, TranslationSchema> = {
  zh,
  en,
};

export function getTranslation(locale: Locale): TranslationSchema {
  return translations[locale] ?? translations.en;
}
