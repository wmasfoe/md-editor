export interface Env {
  RELEASE_BUCKET?: R2Bucket;
  DOWNLOAD_ANALYTICS?: D1Database;
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  DEFAULT_APP?: string;
  PUBLIC_DOMAIN?: string;
  PURGE_TOKEN?: string;
  /** HMAC salt for privacy-safe IP deduplication */
  HMAC_SALT?: string;
}

export interface PlatformAssetInfo {
  version: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface AppVersionManifest {
  app: string;
  updatedAt: string;
  desktop?: {
    version: string;
    releaseNotesUrl?: string;
    assets: {
      macos_arm64?: PlatformAssetInfo;
      macos_x64?: PlatformAssetInfo;
      windows_x64?: PlatformAssetInfo;
      windows_arm64?: PlatformAssetInfo;
      linux_appimage?: PlatformAssetInfo;
      /** Linux ARM64 AppImage（与 linux_appimage 固定为 x64 对应，避免按架构发错包） */
      linux_appimage_arm64?: PlatformAssetInfo;
      linux_deb?: PlatformAssetInfo;
      /** Linux ARM64 DEB（与 linux_deb 固定为 x64 对应） */
      linux_deb_arm64?: PlatformAssetInfo;
    };
  };
  android?: {
    version: string;
    releaseNotesUrl?: string;
    apk: PlatformAssetInfo;
  };
  /**
   * iOS 未签名 IPA 通道：由 `build-ios-ipa.yml` 构建并上传到 R2，
   * 官网与分发网关通过 `/:app/ios/latest` 提供直链，用户侧自签后安装。
   */
  ios?: {
    version: string;
    releaseNotesUrl?: string;
    ipa?: PlatformAssetInfo & {
      /** 未签名包（自签工具重签后方可安装） */
      unsigned?: boolean;
      minimumOSVersion?: string;
    };
    /** 历史字段：曾经预留的 TestFlight / App Store 通道 */
    testFlightUrl?: string;
    appStoreUrl?: string;
  };
}

export interface ReleaseAssetInfo {
  platform:
    | "macos-arm64"
    | "macos-x64"
    | "windows-x64"
    | "windows-arm64"
    | "linux-appimage"
    | "linux-deb"
    | "android"
    | "ios"
    | "updater"
    | "other";
  platformLabel: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes: number;
  formattedSize: string;
  isR2Cached?: boolean;
}

export interface ReleaseInfo {
  version: string;
  tagName: string;
  publishedAt: string;
  isLatest: boolean;
  isPrerelease: boolean;
  releaseNotesUrl: string;
  assets: ReleaseAssetInfo[];
  category?: "desktop" | "android" | "ios" | "all";
}

export interface PlatformLatestSummary {
  version: string;
  downloadUrl?: string;
  fileName?: string;
  formattedSize?: string;
  /** 平台说明文案（如 iOS 的「未签名 IPA（自签安装）」） */
  platformLabel?: string;
  assets?: ReleaseAssetInfo[];
}

export interface ReleasesManifest {
  app: string;
  updatedAt: string;
  total: number;
  latestVersion: string;
  latestDesktopVersion?: string;
  latestAndroidVersion?: string;
  latestIosVersion?: string;
  latestReleases?: {
    desktop?: PlatformLatestSummary;
    android?: PlatformLatestSummary;
    ios?: PlatformLatestSummary;
  };
  releases: ReleaseInfo[];
}
