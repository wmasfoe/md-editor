import type { Locale } from "./i18n/types";
import { SITE_PLATFORMS, type DesktopPlatform, type SitePlatform } from "./platform";
import {
  ANDROID_PORTAL_URL,
  ARTIFACT_NAME_PREFIX,
  buildAndroidApkUrl,
  buildIosIpaUrl,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  DESKTOP_PORTAL_URL,
  GITHUB_RELEASES_URL,
  IOS_PORTAL_URL,
  normalizeVersion,
  RELEASES_PORTAL_URL,
  resolveDevicePortalUrl,
  resolveReleasesPortalUrl,
} from "./site-links";

export const UNIX_INSTALL_COMMAND =
  "curl -fsSL https://download.jiaqi.im/inkpoint/desktop/install.sh | sh";

export const WINDOWS_INSTALL_COMMAND =
  "irm https://download.jiaqi.im/inkpoint/desktop/install.ps1 | iex";

/** 手动安装 DMG 时移除隔离标记；安装脚本会默认处理。 */
export const MACOS_QUARANTINE_COMMAND = "xattr -dr com.apple.quarantine /Applications/Inkpoint.app";

export type DownloadAsset = {
  href: string;
  label: string;
  fileName?: string;
};

export type PlatformDownload = {
  primary: DownloadAsset;
  /** 按钮下方的格式说明，例如 "Apple Silicon · DMG" */
  format: string;
  secondary: DownloadAsset[];
  version?: string;
  isBeta?: boolean;
};

export type DownloadCatalog = Record<SitePlatform, PlatformDownload> & {
  allPackagesUrl: string;
  desktopPackagesUrl: string;
  androidPackagesUrl: string;
  iosPackagesUrl: string;
};

export type PlatformInstall = {
  title: string;
  command: string;
  recommended: boolean;
  extra?: { title: string; command: string };
};

const INSTALL_BY_PLATFORM_ZH: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "终端一键安装",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: "若提示「已损坏」，移除隔离标记",
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "终端一键安装",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell 一键安装",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_ZH_HANT: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "終端機一鍵安裝",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: "若提示「已損壞」，移除隔離標記",
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "終端機一鍵安裝",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell 一鍵安裝",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_JA: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "ターミナルからワンクリックでインストール",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: "「壊れているため開けません」と表示される場合は検疫属性を解除",
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "ターミナルからワンクリックでインストール",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell からワンクリックでインストール",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_EN: Record<"macos" | "linux" | "windows", PlatformInstall> = {
  macos: {
    title: "One-line Terminal Install",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
    extra: {
      title: 'If prompted "damaged", remove quarantine attribute',
      command: MACOS_QUARANTINE_COMMAND,
    },
  },
  linux: {
    title: "One-line Terminal Install",
    command: UNIX_INSTALL_COMMAND,
    recommended: true,
  },
  windows: {
    title: "PowerShell One-line Install",
    command: WINDOWS_INSTALL_COMMAND,
    recommended: false,
  },
};

const INSTALL_BY_PLATFORM_BY_LOCALE: Record<
  Locale,
  Record<"macos" | "linux" | "windows", PlatformInstall>
> = {
  zh: INSTALL_BY_PLATFORM_ZH,
  "zh-Hant": INSTALL_BY_PLATFORM_ZH_HANT,
  ja: INSTALL_BY_PLATFORM_JA,
  en: INSTALL_BY_PLATFORM_EN,
};

const DOWNLOAD_LABELS: Record<
  Locale,
  {
    macos: string;
    linux: string;
    windows: string;
    windowsArm64: string;
    androidPrimary: string;
    androidFormat: string;
    androidSecondary: string;
    iosPrimary: string;
    iosSecondary: string;
    iosFormat: string;
  }
> = {
  zh: {
    macos: "下载 macOS",
    linux: "下载 Linux",
    windows: "下载 Windows",
    windowsArm64: "ARM64 安装包",
    androidPrimary: "下载 Android 安装包 (APK)",
    androidFormat: "Android 8.0+ · APK · 测试版",
    androidSecondary: "最新版直链",
    iosPrimary: "下载 iOS 未签名 IPA",
    iosSecondary: "最新版直链",
    iosFormat: "iOS 17.0+ · 未签名 IPA · 需自签安装",
  },
  "zh-Hant": {
    macos: "下載 macOS",
    linux: "下載 Linux",
    windows: "下載 Windows",
    windowsArm64: "ARM64 安裝套件",
    androidPrimary: "下載 Android 安裝套件 (APK)",
    androidFormat: "Android 8.0+ · APK · 測試版",
    androidSecondary: "最新版直接連結",
    iosPrimary: "下載 iOS 未簽名 IPA",
    iosSecondary: "最新版直接連結",
    iosFormat: "iOS 17.0+ · 未簽名 IPA · 需自行簽名安裝",
  },
  ja: {
    macos: "macOS 版をダウンロード",
    linux: "Linux 版をダウンロード",
    windows: "Windows 版をダウンロード",
    windowsArm64: "ARM64 インストーラー",
    androidPrimary: "Android APK をダウンロード (Beta)",
    androidFormat: "Android 8.0+ · APK · ベータ版",
    androidSecondary: "最新版の直接リンク",
    iosPrimary: "iOS 未署名 IPA をダウンロード",
    iosSecondary: "最新版の直接リンク",
    iosFormat: "iOS 17.0+ · 未署名 IPA · 自己署名インストールが必要",
  },
  en: {
    macos: "Download for macOS",
    linux: "Download for Linux",
    windows: "Download for Windows",
    windowsArm64: "ARM64 Setup",
    androidPrimary: "Download Android APK (Beta)",
    androidFormat: "Android 8.0+ · APK · Beta",
    androidSecondary: "Latest APK Link",
    iosPrimary: "Download iOS IPA (Unsigned)",
    iosSecondary: "Latest IPA Link",
    iosFormat: "iOS 17.0+ · Unsigned IPA · Self-sign required",
  },
};

export const DEFAULT_ANDROID_VERSION = "0.2.1";

export const DEFAULT_IOS_VERSION = "0.2.1";

const MOBILE_PLATFORM_GUIDES: Record<Locale, Record<"android" | "ios", MobilePlatformGuide>> = {
  zh: {
    android: {
      badge: "公测中 · Beta",
      title: "Android 客户端公测说明",
      requirements: "适用于 Android 8.0 (API 26) 及更高版本的手机与平板设备",
      description:
        "Inkpoint 移动端当前处于公测（Beta）阶段，采用原生 CodeMirror 6 编辑引擎，具备离线 Markdown 读写与双向链接能力。",
      tips: "下载 APK 后可直接点击安装。若系统提示「来源未知的应用」，请在系统设置中允许来自此浏览器的应用安装。",
      feedback:
        "公测阶段功能正持续迭代，如遇排版渲染或输入法兼容问题，欢迎前往 GitHub 提交 Issue 反馈。",
    },
    ios: {
      badge: "自签安装 · Beta",
      title: "iOS 客户端安装说明",
      requirements: "适用于 iOS 17.0 及更高版本的 iPhone 与 iPad 设备",
      description:
        "Inkpoint iOS 版以未签名 IPA 形式分发（未上架 App Store，也不走 TestFlight）。你需要在电脑或手机上用自签工具重签名后安装，首次启动需在「设置 → 通用 → VPN与设备管理」中信任对应证书。",
      tips: "推荐工具：\n① Sideloadly（电脑端，Windows / macOS，用 Apple ID 签名后有线安装）\n② AltStore / SideStore（手机上自签，需先配对电脑装一次 AltServer）\n③ LiveContainer（侧载容器，可在其中直接运行未签名 IPA）\n免费 Apple ID 签名有效期为 7 天，到期后用同一工具重新签名即可。",
      feedback:
        "未签名分发自签环节可能因 Xcode / iOS 版本差异出现失败，欢迎在 GitHub 提交 Issue 说明机型与报错。",
    },
  },
  "zh-Hant": {
    android: {
      badge: "公測中 · Beta",
      title: "Android 客戶端公測說明",
      requirements: "適用於 Android 8.0 (API 26) 及更高版本的智慧型手機與平板裝置",
      description:
        "Inkpoint 行動端目前處於公開測試（Beta）階段，採用原生 CodeMirror 6 編輯引擎，具備離線 Markdown 讀寫與雙向連結能力。",
      tips: "下載 APK 後可直接點擊安裝。若系統提示「未知的應用程式」，請在系統設定中允許來自此瀏覽器的應用程式安裝。",
      feedback:
        "公測階段功能持續迭代中，如遇排版渲染或輸入法相容性問題，歡迎前往 GitHub 提交 Issue 反饋。",
    },
    ios: {
      badge: "自行簽名安裝 · Beta",
      title: "iOS 客戶端安裝說明",
      requirements: "適用於 iOS 17.0 及更高版本的 iPhone 與 iPad 裝置",
      description:
        "Inkpoint iOS 版以未簽名 IPA 形式分發（未上架 App Store，也不使用 TestFlight）。你需要用自行簽名工具重新簽名後安裝，首次啟動需在「設定 → 一般 → VPN與裝置管理」中信任對應憑證。",
      tips: "推薦工具：\n① Sideloadly（電腦端，Windows / macOS，以 Apple ID 簽名後有線安裝）\n② AltStore / SideStore（手機自簽，需先與電腦配對安裝 AltServer）\n③ LiveContainer（側載容器，可直接在其中執行未簽名 IPA）\n免費 Apple ID 簽名有效期為 7 天，到期後用同一工具重新簽名即可。",
      feedback:
        "未簽名分發的簽名環節可能因 Xcode / iOS 版本差異而失敗，歡迎在 GitHub 提交 Issue 說明機型與錯誤訊息。",
    },
  },
  ja: {
    android: {
      badge: "パブリックベータ · Beta",
      title: "Android 版ベータテストのご案内",
      requirements: "Android 8.0 (API 26) 以降のスマートフォンおよびタブレットに対応",
      description:
        "Inkpoint モバイル版は現在パブリックベータ版です。ネイティブの CodeMirror 6 エディタエンジンを搭載し、オフラインでの Markdown 編集と双方向リンクに対応しています。",
      tips: "APK のダウンロード後、直接タップしてインストールできます。「提供元不明のアプリ」という警告が表示された場合は、ブラウザの設定からインストールの許可を有効にしてください。",
      feedback:
        "ベータ期間中は継続的に改善を行っています。表示の崩れや入力の不具合などがありましたら、GitHub の Issue よりご報告ください。",
    },
    ios: {
      badge: "自己署名インストール · Beta",
      title: "iOS 版インストールのご案内",
      requirements: "iOS 17.0 以降の iPhone および iPad に対応",
      description:
        "Inkpoint iOS 版は未署名 IPA として配布しています（App Store 未掲載、TestFlight も使用しません）。ご自身で再署名してインストールする必要があり、初回起動時は「設定 → 一般 → VPN とデバイス管理」で証明書を信頼してください。",
      tips: "推奨ツール：\n① Sideloadly（PC 版・Windows / macOS、Apple ID で署名して有線インストール）\n② AltStore / SideStore（iPhone 上で自己署名、事前に PC とペアリングして AltServer を導入）\n③ LiveContainer（サイドロードコンテナ、その中で未署名 IPA を直接実行）\n無料の Apple ID 署名は 7 日間有効で、期限切れ後は同じツールで再署名してください。",
      feedback:
        "未署名配布の署名工程は Xcode / iOS のバージョン差で失敗することがあります。機種とエラー内容を添えて GitHub の Issue よりご報告ください。",
    },
  },
  en: {
    android: {
      badge: "Public Beta",
      title: "Android Beta Guide",
      requirements: "Requires Android 8.0 (API 26) or later (Phones & Tablets)",
      description:
        "Inkpoint Mobile is currently in public beta. Featuring the native CodeMirror 6 engine, bidirectional links, and offline local editing.",
      tips: "Open the APK directly after downloading. If prompted with 'Unknown sources', allow install from this browser in system settings.",
      feedback:
        "Encountered any rendering issues or input glitches? Feel free to report them via GitHub.",
    },
    ios: {
      badge: "Self-signed install · Beta",
      title: "iOS Install Guide",
      requirements: "Requires iOS 17.0 or later on iPhone and iPad",
      description:
        "Inkpoint for iOS ships as an unsigned IPA (not on the App Store, no TestFlight). You need to re-sign it with a sideloading tool before installing; on first launch, trust the certificate under Settings → General → VPN & Device Management.",
      tips: "Recommended tools:\n(1) Sideloadly — desktop (Windows / macOS), signs with your Apple ID and installs over USB\n(2) AltStore / SideStore — self-signing on device, requires pairing with a computer running AltServer once\n(3) LiveContainer — a sideloading container that runs unsigned IPAs directly\nFree Apple ID signatures expire after 7 days; re-sign with the same tool to refresh.",
      feedback:
        "Sideloading can fail depending on your Xcode / iOS versions — open a GitHub issue with your device model and the error message.",
    },
  },
};

/** 按版本和语言构造多平台主下载与次要架构入口；移动端排在最后并标明测试版状态。 */
export function buildDownloadCatalog(
  version?: string,
  locale: Locale = "zh",
  domain?: string,
  androidVersion?: string,
  iosVersion?: string,
): DownloadCatalog {
  const normalized = version ? normalizeVersion(version) : null;
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const mobile = getMobileDownloadCatalog(locale, domain, androidVersion, iosVersion);

  if (!normalized) {
    return fallbackCatalog(locale, domain, androidVersion, iosVersion);
  }

  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;
  const iosPackagesUrl = domain ? resolveDevicePortalUrl("ios", domain) : IOS_PORTAL_URL;

  return {
    macos: {
      primary: {
        href: buildMacosDmgUrl(normalized, domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.dmg`,
        label: labels.macos,
      },
      format: "Apple Silicon · DMG",
      secondary: [],
      version: normalized,
      isBeta: false,
    },
    linux: {
      primary: {
        href: buildLinuxAppImageUrl(normalized, "amd64", domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_amd64.AppImage`,
        label: labels.linux,
      },
      format: "x86_64 · AppImage",
      secondary: [
        {
          href: buildLinuxAppImageUrl(normalized, "aarch64", domain),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_aarch64.AppImage`,
          label: "ARM64 AppImage",
        },
      ],
      version: normalized,
      isBeta: false,
    },
    windows: {
      primary: {
        href: buildWindowsSetupUrl(normalized, "x64", domain),
        fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_x64-setup.exe`,
        label: labels.windows,
      },
      format: "x64 · Setup",
      secondary: [
        {
          href: buildWindowsSetupUrl(normalized, "arm64", domain),
          fileName: `${ARTIFACT_NAME_PREFIX}_${normalized}_arm64-setup.exe`,
          label: labels.windowsArm64,
        },
      ],
      version: normalized,
      isBeta: false,
    },
    android: {
      primary: mobile.android.primary,
      format: mobile.android.format,
      secondary: mobile.android.secondary,
      version: mobile.android.version,
      isBeta: true,
    },
    ios: {
      primary: mobile.ios.primary,
      format: mobile.ios.format,
      secondary: mobile.ios.secondary,
      version: mobile.ios.version,
      isBeta: true,
    },
    allPackagesUrl,
    desktopPackagesUrl,
    androidPackagesUrl,
    iosPackagesUrl,
  };
}

export function getPlatformInstall(platform: DesktopPlatform, locale?: Locale): PlatformInstall;
export function getPlatformInstall(platform: SitePlatform, locale?: Locale): PlatformInstall | null;
export function getPlatformInstall(
  platform: SitePlatform,
  locale: Locale = "zh",
): PlatformInstall | null {
  const table = INSTALL_BY_PLATFORM_BY_LOCALE[locale] ?? INSTALL_BY_PLATFORM_EN;
  return (table as Record<string, PlatformInstall>)[platform] ?? null;
}

export function getPrimaryDownload(
  catalog: DownloadCatalog,
  platform: SitePlatform,
): DownloadAsset {
  return catalog[platform].primary;
}

function fallbackPrimary(label: string, format: string): PlatformDownload {
  return {
    primary: { href: GITHUB_RELEASES_URL, label },
    format,
    secondary: [],
  };
}

function fallbackCatalog(
  locale: Locale = "zh",
  domain?: string,
  androidVersion?: string,
  iosVersion?: string,
): DownloadCatalog {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const mobile = getMobileDownloadCatalog(locale, domain, androidVersion, iosVersion);
  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;
  const iosPackagesUrl = domain ? resolveDevicePortalUrl("ios", domain) : IOS_PORTAL_URL;
  return {
    macos: fallbackPrimary(labels.macos, "Apple Silicon · DMG"),
    linux: fallbackPrimary(labels.linux, "x86_64 · AppImage"),
    windows: fallbackPrimary(labels.windows, "x64 · Setup"),
    android: {
      primary: mobile.android.primary,
      format: mobile.android.format,
      secondary: mobile.android.secondary,
      version: mobile.android.version,
      isBeta: true,
    },
    ios: {
      primary: mobile.ios.primary,
      format: mobile.ios.format,
      secondary: mobile.ios.secondary,
      version: mobile.ios.version,
      isBeta: true,
    },
    allPackagesUrl,
    desktopPackagesUrl,
    androidPackagesUrl,
    iosPackagesUrl,
  };
}

export function listSitePlatforms(): SitePlatform[] {
  return [...SITE_PLATFORMS];
}

export interface MobilePlatformDownload {
  android: {
    primary: DownloadAsset;
    format: string;
    secondary: DownloadAsset[];
    version: string;
  };
  ios: {
    primary: DownloadAsset;
    format: string;
    secondary: DownloadAsset[];
    version: string;
  };
}

/**
 * 构造移动端（Android / iOS）下载目录，标明测试版状态
 */
export function getMobileDownloadCatalog(
  locale: Locale = "zh",
  domain?: string,
  androidVersion = DEFAULT_ANDROID_VERSION,
  iosVersion = DEFAULT_IOS_VERSION,
): MobilePlatformDownload {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const normalizedAndroidVer = normalizeVersion(androidVersion) || DEFAULT_ANDROID_VERSION;
  const normalizedIosVer = normalizeVersion(iosVersion) || DEFAULT_IOS_VERSION;
  return {
    android: {
      primary: {
        href: buildAndroidApkUrl(normalizedAndroidVer, domain),
        fileName: `Inkpoint_${normalizedAndroidVer}.apk`,
        label: labels.androidPrimary,
      },
      format: labels.androidFormat,
      secondary: [
        {
          href: buildAndroidApkUrl(undefined, domain),
          label: labels.androidSecondary,
        },
      ],
      version: normalizedAndroidVer,
    },
    ios: {
      primary: {
        href: buildIosIpaUrl(normalizedIosVer, domain),
        fileName: `Inkpoint-${normalizedIosVer}-unsigned.ipa`,
        label: labels.iosPrimary,
      },
      format: labels.iosFormat,
      secondary: [
        {
          href: buildIosIpaUrl(undefined, domain),
          label: labels.iosSecondary,
        },
      ],
      version: normalizedIosVer,
    },
  };
}

export interface MobilePlatformGuide {
  badge: string;
  title: string;
  requirements: string;
  description: string;
  tips: string;
  feedback: string;
}

export function getMobilePlatformGuide(
  platform: "android" | "ios",
  locale: Locale = "zh",
): MobilePlatformGuide {
  const guides = MOBILE_PLATFORM_GUIDES[locale] ?? MOBILE_PLATFORM_GUIDES.en;
  return guides[platform];
}
