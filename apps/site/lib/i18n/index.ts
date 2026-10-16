import { en } from "./translations/en";
import { ja } from "./translations/ja";
import { zh } from "./translations/zh";
import { zhHant } from "./translations/zh-Hant";
import type { Locale, TranslationSchema } from "./types";

export * from "./detect";
export * from "./types";
export { en, ja, zh, zhHant };

export const translations: Record<Locale, TranslationSchema> = {
  en,
  zh,
  "zh-Hant": zhHant,
  ja,
};

export function getTranslation(locale: Locale): TranslationSchema {
  return translations[locale] ?? translations.en;
}
