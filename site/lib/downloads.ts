import type { Locale } from "./i18n/types";
import { SITE_PLATFORMS, type DesktopPlatform, type SitePlatform } from "./platform";
import {
  ANDROID_PORTAL_URL,
  ARTIFACT_NAME_PREFIX,
  buildAndroidApkUrl,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  DESKTOP_PORTAL_URL,
  GITHUB_RELEASES_URL,
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
    iosPrimary: "加入 iOS TestFlight 公测",
    iosFormat: "iOS 16.0+ · TestFlight · 测试版",
  },
  "zh-Hant": {
    macos: "下載 macOS",
    linux: "下載 Linux",
    windows: "下載 Windows",
    windowsArm64: "ARM64 安裝套件",
    androidPrimary: "下載 Android 安裝套件 (APK)",
    androidFormat: "Android 8.0+ · APK · 測試版",
    androidSecondary: "最新版直接連結",
    iosPrimary: "加入 iOS TestFlight 公測",
    iosFormat: "iOS 16.0+ · TestFlight · 測試版",
  },
  ja: {
    macos: "macOS 版をダウンロード",
    linux: "Linux 版をダウンロード",
    windows: "Windows 版をダウンロード",
    windowsArm64: "ARM64 インストーラー",
    androidPrimary: "Android APK をダウンロード (Beta)",
    androidFormat: "Android 8.0+ · APK · ベータ版",
    androidSecondary: "最新版の直接リンク",
    iosPrimary: "iOS TestFlight パブリックベータに参加",
    iosFormat: "iOS 16.0+ · TestFlight · ベータ版",
  },
  en: {
    macos: "Download for macOS",
    linux: "Download for Linux",
    windows: "Download for Windows",
    windowsArm64: "ARM64 Setup",
    androidPrimary: "Download Android APK (Beta)",
    androidFormat: "Android 8.0+ · APK · Beta",
    androidSecondary: "Latest APK Link",
    iosPrimary: "Join iOS TestFlight (Beta)",
    iosFormat: "iOS 16.0+ · TestFlight · Beta",
  },
};

export const DEFAULT_ANDROID_VERSION = "0.2.0";

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
      badge: "公测中 · Beta",
      title: "iOS 客户端公测说明",
      requirements: "适用于 iOS 16.0 及更高版本的 iPhone 与 iPad 设备",
      description:
        "Inkpoint iOS 版目前通过 Apple 官方 TestFlight 进行公测体验，免签名、更稳定、体验丝滑。",
      tips: "请先在 App Store 下载安装 Apple 官方「TestFlight」应用，随后点击上方按钮加入 Inkpoint 公测。",
      feedback: "可直接在 TestFlight 应用中截屏并反馈体验建议，或在 GitHub 提交反馈。",
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
      badge: "公測中 · Beta",
      title: "iOS 客戶端公測說明",
      requirements: "適用於 iOS 16.0 及更高版本的 iPhone 與 iPad 裝置",
      description:
        "Inkpoint iOS 版目前透過 Apple 官方 TestFlight 進行公開測試，免簽名、更穩定、體驗流暢。",
      tips: "請先在 App Store 下載安裝 Apple 官方「TestFlight」應用程式，隨後點擊上方按鈕加入 Inkpoint 公測。",
      feedback: "可直接在 TestFlight 應用程式中截圖反饋體驗建議，或前往 GitHub 提交回饋。",
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
      badge: "パブリックベータ · Beta",
      title: "iOS TestFlight ベータテストのご案内",
      requirements: "iOS 16.0 以降の iPhone および iPad に対応",
      description:
        "Inkpoint iOS 版は Apple 公式の TestFlight を通じてパブリックベータを提供しています。署名作業不要で安全かつスムーズにご利用いただけます。",
      tips: "App Store から Apple 公式の「TestFlight」アプリをインストールした後、上のボタンをタップしてベータテストに参加してください。",
      feedback:
        "TestFlight アプリ内で直接スクリーンショットを撮影してフィードバックを送信するか、GitHub でご報告ください。",
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
      badge: "Public Beta",
      title: "iOS TestFlight Beta Guide",
      requirements: "Requires iOS 16.0 or later on iPhone and iPad",
      description:
        "Inkpoint for iOS is distributed via Apple TestFlight public beta — official, secure, and easy to install.",
      tips: "Please install the Apple 'TestFlight' app from the App Store first, then tap the button above to join the Beta.",
      feedback: "You can share screenshots directly inside TestFlight or report issues via GitHub.",
    },
  },
};

/** 按版本和语言构造多平台主下载与次要架构入口；移动端排在最后并标明测试版状态。 */
export function buildDownloadCatalog(
  version?: string,
  locale: Locale = "zh",
  domain?: string,
  androidVersion?: string,
): DownloadCatalog {
  const normalized = version ? normalizeVersion(version) : null;
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const mobile = getMobileDownloadCatalog(locale, domain, androidVersion);

  if (!normalized) {
    return fallbackCatalog(locale, domain, androidVersion);
  }

  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;

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
): DownloadCatalog {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const mobile = getMobileDownloadCatalog(locale, domain, androidVersion);
  const allPackagesUrl = domain ? resolveReleasesPortalUrl(domain) : RELEASES_PORTAL_URL;
  const desktopPackagesUrl = domain
    ? resolveDevicePortalUrl("desktop", domain)
    : DESKTOP_PORTAL_URL;
  const androidPackagesUrl = domain
    ? resolveDevicePortalUrl("android", domain)
    : ANDROID_PORTAL_URL;
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
): MobilePlatformDownload {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const normalizedAndroidVer = normalizeVersion(androidVersion) || DEFAULT_ANDROID_VERSION;
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
        href: "https://testflight.apple.com/join/placeholder",
        label: labels.iosPrimary,
      },
      format: labels.iosFormat,
      secondary: [],
      version: "0.1.0",
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
