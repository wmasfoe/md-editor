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
  ios?: {
    version: string;
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
  category?: "desktop" | "android" | "all";
}

export interface PlatformLatestSummary {
  version: string;
  downloadUrl?: string;
  fileName?: string;
  formattedSize?: string;
  assets?: ReleaseAssetInfo[];
}

export interface ReleasesManifest {
  app: string;
  updatedAt: string;
  total: number;
  latestVersion: string;
  latestDesktopVersion?: string;
  latestAndroidVersion?: string;
  latestReleases?: {
    desktop?: PlatformLatestSummary;
    android?: PlatformLatestSummary;
  };
  releases: ReleaseInfo[];
}
