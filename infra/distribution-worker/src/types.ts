export interface Env {
  RELEASE_BUCKET?: R2Bucket;
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  DEFAULT_APP?: string;
  PUBLIC_DOMAIN?: string;
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
      linux_deb?: PlatformAssetInfo;
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
