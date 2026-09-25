/**
 * 语言定义与翻译契约
 * en: 英文
 * zh: 简体中文
 * zh-Hant: 繁体中文
 * ja: 日文
 */

export type Locale = "zh" | "en" | "zh-Hant" | "ja";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "zh", "zh-Hant", "ja"] as const;

export const DEFAULT_LOCALE: Locale = "en";
export const DEFAULT_NON_CHINESE_LOCALE: Locale = "en";
export const CHINESE_LOCALE: Locale = "zh";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
};

export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: "EN",
  zh: "中",
  "zh-Hant": "繁",
  ja: "日",
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  en: "🇺🇸",
  zh: "🇨🇳",
  "zh-Hant": "🇭🇰",
  ja: "🇯🇵",
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
    playground: string;
    playgroundShort: string;
    github: string;
    download: string;
    langSwitchAria: string;
    navAria: string;
  };
  hero: {
    tagline: string;
    subtitle: string;
    previewHeading: string;
    latestPrefix: string;
    allPackages: string;
    exploreFeatures: string;
    getClient: string;
    tryOnline: string;
    allDownloadOptions: string;
  };
  previewBadges: {
    editor: FeatureItem;
    ai: FeatureItem;
    mdx: FeatureItem;
  };
  editorFeature: {
    sectionAria: string;
    badge: string;
    title: string;
    subtitle: string;
    loadingCanvas: string;
  };
  editorPreview: {
    workspace: string;
    sampleFile: string;
    quote: string;
    description: string;
    calloutText: string;
  };
  liveEditor: {
    samplesTitle: string;
    canvasTitle: string;
    canvasDescription: string;
    samplesPrefix: string;
    sourceMode: string;
    wysiwygMode: string;
  };
  mdxShowcase: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    sectionAria: string;
    sourceLabel: string;
    previewLabel: string;
    calloutTitle: string;
    calloutBody: string;
    heading: string;
    lead: string;
    body: string;
    sourceFilename: string;
    loadingCanvas: string;
  };
  download: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
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
    comingSoon: string;
    betaStatus: string;
    systemRequirements: string;
    installationTip: string;
    ariaAndroidBeta: string;
    ariaIosComingSoon: string;
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
    tabsAria: string;
    clientTab: string;
    androidTab: string;
    webTab: string;
    modelTab: string;
    descriptionPrefix: string;
    descriptionSuffix: string;
    androidDescriptionPrefix: string;
    webDescriptionPrefix: string;
    modelDescriptionPrefix: string;
    modelDescriptionSuffix: string;
    modelOriginalLanguage: string;
    empty: string;
    androidEmpty: string;
    webEmpty: string;
    modelEmpty: string;
    listAria: string;
    modelListAria: string;
    latestBadge: string;
    importantBadge: string;
    pullRequestAria: string;
    downloadVersion: string;
    edgeDownloads: string;
    viewAllArchitectures: string;
    itemTypes: {
      feat: string;
      perf: string;
      fix: string;
      refactor: string;
      breaking: string;
      other: string;
    };
    backHome: string;
  };
  footer: {
    summary: string;
    playground: string;
    github: string;
    releases: string;
  };
  aiShowcase: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    sectionAria: string;
    loadingCanvas: string;
    tabGrammar: string;
    tabContinuation: string;
    statusSlmReady: string;
    statusGrammarReady: string;
    statusContinuationReady: string;
    statusAllCompleted: string;
    statusDismissed: string;
    acceptButton: string;
    dismissButton: string;
    retriggerButton: string;
    resetButton: string;
    stepFormat: string;
    tipInteractive: string;
    tipCompleted: string;
    tipDismissed: string;
    tabHint: string;
    phase1Tip: string;
    phase2Tip: string;
    initialTip: string;
    bento: {
      local: {
        title: string;
        desc: string;
        tag: string;
      };
      flow: {
        title: string;
        desc: string;
        tag: string;
      };
      context: {
        title: string;
        desc: string;
        tag: string;
      };
    };
  };
  releases: {
    title: string;
    subtitle: string;
    backHome: string;
    breadcrumbRoot: string;
    breadcrumbApp: string;
    overviewTitle: string;
    colDevice: string;
    colLatest: string;
    colCoverage: string;
    deviceDesktop: string;
    deviceDesktopCoverage: string;
    deviceAndroid: string;
    deviceAndroidCoverage: string;
    deviceIos: string;
    deviceIosCoverage: string;
    iosStatus: string;
    iosNotice: string;
    colVersion: string;
    colDate: string;
    colPackages: string;
    latestBadge: string;
    betaBadge: string;
    viewNotes: string;
    macArm: string;
    macIntel: string;
    windows: string;
    linuxAppImage: string;
    linuxDeb: string;
    androidApk: string;
    allVersions: string;
    colAction: string;
    viewHistory: string;
  };
}
