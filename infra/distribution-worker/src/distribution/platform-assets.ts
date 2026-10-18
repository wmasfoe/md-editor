/**
 * @file platform-assets.ts
 * @description 平台/架构识别、MIME 推断与桌面资产匹配（自 router.ts 拆出，行为不变）。
 */

import type { AppVersionManifest, PlatformAssetInfo } from "../types.ts";

export const MIME_TYPES: Record<string, string> = {
  dmg: "application/x-apple-diskimage",
  exe: "application/x-msdownload",
  AppImage: "application/x-executable",
  appimage: "application/x-executable",
  deb: "application/vnd.debian.binary-package",
  apk: "application/vnd.android.package-archive",
  ipa: "application/octet-stream",
  gz: "application/gzip",
  zip: "application/zip",
  sig: "text/plain",
  json: "application/json",
};

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * 架构归一化：安装包文件名混用 aarch64/arm64、amd64/x86_64/x64 四种写法，
 * 必须同时识别，否则按架构分发会错配（历史教训：aarch64 不含 arm64 子串）。
 */
export function isArm64AssetName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("arm64") || lower.includes("aarch64");
}

export function isX64AssetName(name: string): boolean {
  const lower = name.toLowerCase();
  if (isArm64AssetName(lower)) return false;
  return lower.includes("x64") || lower.includes("x86_64") || lower.includes("amd64");
}

/**
 * 辅助函数：根据平台关键词从 GitHub Release 资产列表中匹配对应的安装包 URL
 */
export function matchDesktopAsset(
  assets: Array<{ name: string; browser_download_url: string; size: number }>,
  platform: string,
): { name: string; url: string; size: number } | null {
  const p = platform.toLowerCase();

  for (const asset of assets) {
    const name = asset.name.toLowerCase();

    // macOS Apple Silicon (ARM64)
    if (
      (p === "macos" || p === "macos-arm64" || p === "mac" || p === "mac-arm64") &&
      name.endsWith(".dmg")
    ) {
      if (name.includes("aarch64") || name.includes("arm64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // macOS Intel (x64)
    if ((p === "macos-x64" || p === "mac-intel") && name.endsWith(".dmg")) {
      if (name.includes("x64") || name.includes("x86_64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // Windows x64 Setup
    if (
      (p === "windows" || p === "windows-x64" || p === "win" || p === "win-x64") &&
      name.endsWith(".exe")
    ) {
      if (name.includes("x64") && !name.includes("arm64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // Windows ARM64 Setup
    if ((p === "windows-arm64" || p === "win-arm64") && name.endsWith(".exe")) {
      if (name.includes("arm64")) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // Linux AppImage：泛 linux 键默认 x64（与官网“x86_64 · AppImage”主按钮一致），
    // 点名 linux-arm64 才取 ARM 构建，避免单槽位按 readdir 顺序错发。
    if (
      (p === "linux" || p === "linux-x64" || p === "linux-amd64" || p === "appimage") &&
      name.endsWith(".appimage") &&
      isX64AssetName(name)
    ) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    if (
      (p === "linux-arm64" || p === "linux-aarch64" || p === "appimage-arm64") &&
      name.endsWith(".appimage") &&
      isArm64AssetName(name)
    ) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    // Linux Deb：泛 linux-deb 键默认 x64，点名 linux-deb-arm64 才取 ARM 构建。
    if (
      (p === "linux-deb" || p === "deb" || p === "deb-x64") &&
      name.endsWith(".deb") &&
      isX64AssetName(name)
    ) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    if (
      (p === "linux-deb-arm64" || p === "deb-arm64" || p === "deb-aarch64") &&
      name.endsWith(".deb") &&
      isArm64AssetName(name)
    ) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
  }

  // 宽松回退匹配
  for (const asset of assets) {
    const name = asset.name.toLowerCase();
    if ((p.includes("mac") || p.includes("dmg")) && name.endsWith(".dmg")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    if ((p.includes("win") || p.includes("exe")) && name.endsWith(".exe")) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
    if (p.includes("linux") && name.endsWith(".appimage")) {
      // 同一 release 存在双架构时优先与请求键同架构，避免错发。
      if (p.includes("arm") || p.includes("aarch")) {
        if (isArm64AssetName(name)) {
          return { name: asset.name, url: asset.browser_download_url, size: asset.size };
        }
        continue;
      }
      if (isX64AssetName(name)) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    if (p.includes("linux") && name.endsWith(".deb")) {
      if (p.includes("arm") || p.includes("aarch")) {
        if (isArm64AssetName(name)) {
          return { name: asset.name, url: asset.browser_download_url, size: asset.size };
        }
        continue;
      }
      if (isX64AssetName(name)) {
        return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
    }
    // 极端兜底：该扩展名只剩异架构产物时返回任一可用包，好过 404。
    if (p.includes("linux") && (name.endsWith(".appimage") || name.endsWith(".deb"))) {
      return { name: asset.name, url: asset.browser_download_url, size: asset.size };
    }
  }

  return null;
}

/** 根据请求平台从版本清单选择对应的桌面安装包。 */
export function selectDesktopManifestAsset(
  manifest: AppVersionManifest | null,
  platform: string,
): PlatformAssetInfo | undefined {
  const assets = manifest?.desktop?.assets;
  if (!assets) return undefined;

  if (platform.includes("mac") || platform.includes("dmg")) {
    return platform.includes("x64") ? assets.macos_x64 : assets.macos_arm64;
  }
  if (platform.includes("win") || platform.includes("exe")) {
    return platform.includes("arm64") ? assets.windows_arm64 : assets.windows_x64;
  }
  if (platform.includes("deb")) {
    // deb 与 appimage 分槽：泛键默认 x64，点名 arm 才取 ARM 槽，绝不跨架构回退。
    if (platform.includes("arm") || platform.includes("aarch")) return assets.linux_deb_arm64;
    return assets.linux_deb;
  }
  if (platform.includes("linux") || platform.includes("appimage")) {
    if (platform.includes("arm") || platform.includes("aarch")) return assets.linux_appimage_arm64;
    return assets.linux_appimage;
  }
  return undefined;
}
