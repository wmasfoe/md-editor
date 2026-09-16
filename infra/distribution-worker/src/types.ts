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
