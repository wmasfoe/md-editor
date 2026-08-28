/**
 * 语言定义与翻译契约
 * zh: 简体中文
 * en: 英文
 */

export type Locale = "zh" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh", "en"] as const;

export const DEFAULT_NON_CHINESE_LOCALE: Locale = "en";
export const CHINESE_LOCALE: Locale = "zh";

export const LOCALE_LABELS: Record<Locale, string> = {
  zh: "简体中文",
  en: "English",
};

export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  zh: "中",
  en: "EN",
};

export interface FeatureItem {
  title: string;
  description: string;
}

export interface TranslationSchema {
  meta: {
    title: string;
    description: string;
  };
  header: {
    changelog: string;
    changelogShort: string;
    github: string;
    download: string;
    langSwitchAria: string;
  };
  hero: {
    tagline: string;
    subtitle: string;
    latestPrefix: string;
    allPackages: string;
  };
  download: {
    tablistAria: string;
    primaryMacos: string;
    primaryLinux: string;
    primaryWindows: string;
    secondaryLinuxArm64: string;
    secondaryWindowsArm64: string;
    installMacosTitle: string;
    installMacosExtra: string;
    installLinuxTitle: string;
    installWindowsTitle: string;
    recommendedTag: string;
    copyButton: string;
    copiedButton: string;
    copyCommandAria: string;
  };
  features: {
    sectionAria: string;
    items: FeatureItem[];
  };
  status: {
    latestTitle: string;
    allChangelog: string;
    downloadVersion: string;
    historyVersions: string;
    noChangelog: string;
    webAppTitle: string;
    webAppStatus: string;
    webAppDescription: string;
    notOpenYet: string;
  };
  changelog: {
    title: string;
    badge: string;
    descriptionPrefix: string;
    descriptionSuffix: string;
    empty: string;
    listAria: string;
    latestBadge: string;
    backHome: string;
  };
  footer: {
    summary: string;
    github: string;
  };
}
