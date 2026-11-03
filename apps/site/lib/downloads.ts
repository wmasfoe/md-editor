import type { Locale } from "./i18n/types";
import { SITE_PLATFORMS, type DesktopPlatform, type SitePlatform } from "./platform";
import {
  ANDROID_PORTAL_URL,
  ANDROID_SOURCE_GUIDE_URL,
  ARTIFACT_NAME_PREFIX,
  buildLinuxAppImageUrl,
  buildMacosDmgUrl,
  buildWindowsSetupUrl,
  DESKTOP_PORTAL_URL,
  GITHUB_RELEASES_URL,
  IOS_PORTAL_URL,
  IOS_SOURCE_GUIDE_URL,
  normalizeVersion,
  RELEASES_PORTAL_URL,
  resolveDevicePortalUrl,
  resolveReleasesPortalUrl,
} from "./site-links";

export { ANDROID_SOURCE_GUIDE_URL, IOS_SOURCE_GUIDE_URL };

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
    androidPrimary: "查看 Android 源码编译说明",
    androidFormat: "Android 8.0+ · 暂无安装包 · 需自行编译源码",
    androidSecondary: "源码编译说明",
    iosPrimary: "查看 iOS 源码编译说明",
    iosSecondary: "源码编译说明",
    iosFormat: "iOS 17.0+ · 暂无安装包 · 需自行编译源码",
  },
  "zh-Hant": {
    macos: "下載 macOS",
    linux: "下載 Linux",
    windows: "下載 Windows",
    windowsArm64: "ARM64 安裝套件",
    androidPrimary: "查看 Android 原始碼編譯說明",
    androidFormat: "Android 8.0+ · 暫無安裝套件 · 需自行編譯原始碼",
    androidSecondary: "原始碼編譯說明",
    iosPrimary: "查看 iOS 原始碼編譯說明",
    iosSecondary: "原始碼編譯說明",
    iosFormat: "iOS 17.0+ · 暫無安裝套件 · 需自行編譯原始碼",
  },
  ja: {
    macos: "macOS 版をダウンロード",
    linux: "Linux 版をダウンロード",
    windows: "Windows 版をダウンロード",
    windowsArm64: "ARM64 インストーラー",
    androidPrimary: "Android ビルド手順を見る",
    androidFormat: "Android 8.0+ · パッケージ提供なし · 自行ビルドが必要",
    androidSecondary: "ビルド手順",
    iosPrimary: "iOS ビルド手順を見る",
    iosSecondary: "ビルド手順",
    iosFormat: "iOS 17.0+ · パッケージ提供なし · 自行ビルドが必要",
  },
  en: {
    macos: "Download for macOS",
    linux: "Download for Linux",
    windows: "Download for Windows",
    windowsArm64: "ARM64 Setup",
    androidPrimary: "View Android Build Guide",
    androidFormat: "Android 8.0+ · No pre-built package · Build from source",
    androidSecondary: "Build Guide",
    iosPrimary: "View iOS Build Guide",
    iosSecondary: "Build Guide",
    iosFormat: "iOS 17.0+ · No pre-built package · Build from source",
  },
};

export const DEFAULT_ANDROID_VERSION = "0.2.1";

export const DEFAULT_IOS_VERSION = "0.2.1";

const MOBILE_PLATFORM_GUIDES: Record<Locale, Record<"android" | "ios", MobilePlatformGuide>> = {
  zh: {
    android: {
      badge: "源码编译 · 暂无安装包",
      title: "Android 客户端编译与运行指南",
      requirements: "适用于 Android 8.0 (API 26)+ 设备，需本地配置 JDK 17 与 Android SDK",
      description:
        "Inkpoint 移动端目前处于开源开发阶段，暂不提供预编译安装包（APK）。如有体验或使用需求，请克隆开源仓库并在本地自行编译源码运行。",
      tips: "快速编译运行步骤：\n① 克隆仓库并安装依赖：pnpm install\n② 同步移动端 Web 离线内核：pnpm build:mobile\n③ 运行与调试：执行 pnpm android 或通过 Android Studio 打开 apps/mobile/android 工程\n④ 打包 APK：在 apps/mobile/android 目录下执行 ./gradlew assembleDebug",
      feedback:
        "移动端功能持续迭代中，如在编译构建或体验过程中遇到问题，欢迎前往 GitHub 提交 Issue 反馈。",
    },
    ios: {
      badge: "源码编译 · 暂无安装包",
      title: "iOS 客户端编译与运行指南",
      requirements: "适用于 iOS 17.0+ 的 iPhone 与 iPad，需 macOS 与最新 Xcode (Swift 6)",
      description:
        "Inkpoint 移动端目前处于开源开发阶段，暂不提供预编译安装包（IPA）。如有体验或使用需求，请克隆开源仓库并在本地通过 Xcode 自行编译源码运行。",
      tips: "快速编译运行步骤：\n① 克隆仓库并安装依赖：pnpm install\n② 同步移动端 Web 离线内核：pnpm build:mobile\n③ 运行与调试：执行 pnpm ios 或通过 Xcode 打开 apps/mobile/ios/Inkpoint.xcodeproj 工程\n④ 在 Xcode 中连接真机或启动模拟器直接点击 Run 即可构建运行",
      feedback:
        "移动端功能持续迭代中，如在编译构建或体验过程中遇到问题，欢迎前往 GitHub 提交 Issue 反馈。",
    },
  },
  "zh-Hant": {
    android: {
      badge: "原始碼編譯 · 暫無安裝套件",
      title: "Android 客戶端編譯與執行指南",
      requirements: "適用於 Android 8.0 (API 26)+ 裝置，需本地配置 JDK 17 與 Android SDK",
      description:
        "Inkpoint 行動端目前處於開源開發階段，暫不提供預編譯安裝套件（APK）。如有體驗或使用需求，請複製開源儲存庫並在本地自行編譯原始碼執行。",
      tips: "快速編譯執行步驟：\n① 複製開源儲存庫並安裝依賴：pnpm install\n② 同步行動端 Web 離線核心：pnpm build:mobile\n③ 執行與除錯：執行 pnpm android 或透過 Android Studio 開啟 apps/mobile/android 專案\n④ 打包 APK：在 apps/mobile/android 目錄下執行 ./gradlew assembleDebug",
      feedback:
        "行動端功能持續迭代中，如在編譯建置或體驗過程中遇到問題，歡迎前往 GitHub 提交 Issue 反饋。",
    },
    ios: {
      badge: "原始碼編譯 · 暫無安裝套件",
      title: "iOS 客戶端編譯與執行指南",
      requirements: "適用於 iOS 17.0+ 的 iPhone 與 iPad，需 macOS 與最新 Xcode (Swift 6)",
      description:
        "Inkpoint 行動端目前處於開源開發階段，暫不提供預編譯安裝套件（IPA）。如有體驗或使用需求，請複製開源儲存庫並在本地透過 Xcode 自行編譯原始碼執行。",
      tips: "快速編譯執行步驟：\n① 複製開源儲存庫並安裝依賴：pnpm install\n② 同步行動端 Web 離線核心：pnpm build:mobile\n③ 執行與除錯：執行 pnpm ios 或透過 Xcode 開啟 apps/mobile/ios/Inkpoint.xcodeproj 專案\n④ 在 Xcode 中連接實體裝置或啟動模擬器直接點擊 Run 即可建置執行",
      feedback:
        "行動端功能持續迭代中，如在編譯建置或體驗過程中遇到問題，歡迎前往 GitHub 提交 Issue 反饋。",
    },
  },
  ja: {
    android: {
      badge: "ソースコードビルド · パッケージ提供なし",
      title: "Android 版ビルド＆実行ガイド",
      requirements: "Android 8.0 (API 26)+ 端末に対応（ローカルに JDK 17 と Android SDK が必要）",
      description:
        "Inkpoint モバイル版は現在開発中であり、事前ビルド済みパッケージ（APK）の配布は行っておりません。ご利用の場合は、リポジトリをクローンしてローカルでソースコードからビルドしてください。",
      tips: "クイックビルド手順：\n① リポジトリをクローンし依存関係を導入：pnpm install\n② モバイル Web オフラインコアを同期：pnpm build:mobile\n③ 実行とデバッグ：pnpm android を実行するか、Android Studio で apps/mobile/android を開く\n④ APK パッケージ化：apps/mobile/android で ./gradlew assembleDebug を実行",
      feedback:
        "モバイル版は継続的に開発中です。ビルドや動作に関する問題がありましたら、GitHub の Issue よりご報告ください。",
    },
    ios: {
      badge: "ソースコードビルド · パッケージ提供なし",
      title: "iOS 版ビルド＆実行ガイド",
      requirements:
        "iOS 17.0+ の iPhone / iPad に対応（macOS および最新の Xcode / Swift 6 が必要）",
      description:
        "Inkpoint モバイル版は現在開発中であり、事前ビルド済みパッケージ（IPA）の配布は行っておりません。ご利用の場合は、リポジトリをクローンして Xcode でソースコードからビルドしてください。",
      tips: "クイックビルド手順：\n① リポジトリをクローンし依存関係を導入：pnpm install\n② モバイル Web オフラインコアを同期：pnpm build:mobile\n③ 実行とデバッグ：pnpm ios を実行するか、Xcode で apps/mobile/ios/Inkpoint.xcodeproj を開く\n④ 実機を接続するかシミュレータを選択して Run を実行",
      feedback:
        "モバイル版は継続的に開発中です。ビルドや動作に関する問題がありましたら、GitHub の Issue よりご報告ください。",
    },
  },
  en: {
    android: {
      badge: "Source Build · No Pre-built Package",
      title: "Android Client Build & Run Guide",
      requirements: "Requires Android 8.0+ (API 26), local JDK 17 and Android SDK",
      description:
        "Inkpoint Mobile is currently in open-source development. Pre-compiled installation packages (APKs) are not provided. If needed, please clone the repository and compile the source code locally.",
      tips: "Quick start steps:\n1. Clone repository and install dependencies: pnpm install\n2. Sync mobile Web offline core: pnpm build:mobile\n3. Run & debug: execute pnpm android or open apps/mobile/android in Android Studio\n4. Build APK: run ./gradlew assembleDebug under apps/mobile/android",
      feedback:
        "Mobile features are actively evolving. If you encounter any build issues, please open an issue on GitHub.",
    },
    ios: {
      badge: "Source Build · No Pre-built Package",
      title: "iOS Client Build & Run Guide",
      requirements: "Requires iOS 17.0+ on iPhone/iPad, macOS, and latest Xcode (Swift 6)",
      description:
        "Inkpoint Mobile is currently in open-source development. Pre-compiled installation packages (IPAs) are not provided. If needed, please clone the repository and compile the source code locally via Xcode.",
      tips: "Quick start steps:\n1. Clone repository and install dependencies: pnpm install\n2. Sync mobile Web offline core: pnpm build:mobile\n3. Run & debug: execute pnpm ios or open apps/mobile/ios/Inkpoint.xcodeproj in Xcode\n4. Connect your device or select a simulator and click Run in Xcode",
      feedback:
        "Mobile features are actively evolving. If you encounter any build issues, please open an issue on GitHub.",
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
 * 构造移动端（Android / iOS）下载目录，标明源码编译与无预编译包状态
 */
export function getMobileDownloadCatalog(
  locale: Locale = "zh",
  _domain?: string,
  androidVersion = DEFAULT_ANDROID_VERSION,
  iosVersion = DEFAULT_IOS_VERSION,
): MobilePlatformDownload {
  const labels = DOWNLOAD_LABELS[locale] ?? DOWNLOAD_LABELS.en;
  const normalizedAndroidVer = normalizeVersion(androidVersion) || DEFAULT_ANDROID_VERSION;
  const normalizedIosVer = normalizeVersion(iosVersion) || DEFAULT_IOS_VERSION;
  return {
    android: {
      primary: {
        href: ANDROID_SOURCE_GUIDE_URL,
        label: labels.androidPrimary,
      },
      format: labels.androidFormat,
      secondary: [],
      version: normalizedAndroidVer,
    },
    ios: {
      primary: {
        href: IOS_SOURCE_GUIDE_URL,
        label: labels.iosPrimary,
      },
      format: labels.iosFormat,
      secondary: [],
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
