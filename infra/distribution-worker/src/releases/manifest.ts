/**
 * @file manifest.ts
 * @description 全量历史版本清单构建：R2 releases.json → GitHub → 内置 fallback，
 * 叠加 version.json 的桌面/Android/iOS 元数据与移动端历史（自 router.ts 整体平移，行为不变）。
 */

import type {
  AppVersionManifest,
  Env,
  ReleaseAssetInfo,
  ReleaseInfo,
  ReleasesManifest,
} from "../types.ts";
import { fetchAllGitHubReleases } from "../distribution/github-releases.ts";
import { isArm64AssetName } from "../distribution/platform-assets.ts";
import { compareSemver } from "./semver.ts";
import { formatBytes } from "../shared/format-bytes.ts";
import fallbackManifest from "../fallback-releases.json";

/**
 * 汇总构建全量历史版本清单
 */
export async function buildReleasesManifest(
  app: string,
  githubRepo: string,
  env: Env,
  baseUrl: string,
): Promise<ReleasesManifest> {
  let releases: ReleaseInfo[] = [];

  // 1. 如果 R2 中保存了预构建的 releases.json，优先直接读取
  if (env.RELEASE_BUCKET) {
    const r2Obj = await env.RELEASE_BUCKET.get(`${app}/releases.json`);
    if (r2Obj) {
      try {
        const text = await r2Obj.text();
        const parsed = JSON.parse(text) as ReleasesManifest;
        if (Array.isArray(parsed.releases) && parsed.releases.length > 0) {
          releases = parsed.releases;
        }
      } catch {
        // 解析失败则继续动态构建
      }
    }
  }

  // 2. 如果 R2 未命中，尝试从 GitHub 拉取全量 releases
  if (releases.length === 0) {
    const rawReleases = await fetchAllGitHubReleases(githubRepo, env);
    for (const raw of rawReleases) {
      const tagName = raw.tag_name || "";
      const isAndroidTag = tagName.startsWith("android-v") || tagName.startsWith("mobile-v");
      const isDesktopTag = tagName.startsWith("desktop-v") || /^v\d/.test(tagName);

      const assets: ReleaseAssetInfo[] = [];

      for (const asset of raw.assets || []) {
        const name = asset.name;
        const lower = name.toLowerCase();

        let platform: ReleaseAssetInfo["platform"] = "other";
        let platformLabel = "其他附件";

        if (lower.endsWith(".dmg")) {
          if (lower.includes("x64") || lower.includes("x86_64") || lower.includes("intel")) {
            platform = "macos-x64";
            platformLabel = "macOS (Intel) · DMG";
          } else {
            platform = "macos-arm64";
            platformLabel = "macOS (Apple Silicon) · DMG";
          }
        } else if (lower.endsWith(".exe")) {
          if (lower.includes("arm64")) {
            platform = "windows-arm64";
            platformLabel = "Windows (ARM64) · Setup";
          } else {
            platform = "windows-x64";
            platformLabel = "Windows (x64) · Setup";
          }
        } else if (lower.endsWith(".appimage")) {
          platform = "linux-appimage";
          platformLabel = isArm64AssetName(lower)
            ? "Linux (ARM64) · AppImage"
            : "Linux (x86_64) · AppImage";
        } else if (lower.endsWith(".deb")) {
          platform = "linux-deb";
          platformLabel = isArm64AssetName(lower) ? "Linux (ARM64) · DEB" : "Linux (x86_64) · DEB";
        } else if (lower.endsWith(".apk")) {
          platform = "android";
          platformLabel = "Android · APK";
        } else if (lower.endsWith(".tar.gz") || lower.endsWith(".sig")) {
          platform = "updater";
          platformLabel = lower.endsWith(".sig") ? "Tauri 签名文件" : "Tauri 自动更新包";
        }

        const rawVersionForAsset = tagName
          .replace(/^(?:desktop-)?v/i, "")
          .replace(/^(?:android|mobile)-v?/i, "");
        const downloadUrl = `${baseUrl}/${app}/${rawVersionForAsset}/${encodeURIComponent(name)}`;

        assets.push({
          platform,
          platformLabel,
          fileName: name,
          downloadUrl,
          sizeBytes: asset.size,
          formattedSize: formatBytes(asset.size),
          isR2Cached: rawVersionForAsset === "0.10.2",
        });
      }

      const hasAndroid = assets.some((a) => a.platform === "android");
      const hasDesktop = assets.some(
        (a) =>
          a.platform.includes("macos") ||
          a.platform.includes("windows") ||
          a.platform.includes("linux"),
      );

      const isAndroidRelease = isAndroidTag || (hasAndroid && !hasDesktop);
      const isDesktopRelease = !isAndroidRelease && (isDesktopTag || hasDesktop);

      // 仅保留桌面客户端与 Android 移动端发行版本，过滤 utools-v*、web-v* 或未知仓库 tag
      if (!isAndroidRelease && !isDesktopRelease) {
        continue;
      }

      const category: ReleaseInfo["category"] = isAndroidRelease ? "android" : "desktop";
      const version = isAndroidRelease
        ? tagName.replace(/^(?:android|mobile)-v?/i, "")
        : tagName.replace(/^(?:desktop-)?v/i, "");

      releases.push({
        version,
        tagName: raw.tag_name,
        publishedAt: raw.published_at || new Date().toISOString(),
        isLatest: false,
        isPrerelease: Boolean(raw.prerelease),
        category,
        releaseNotesUrl:
          raw.html_url || `https://github.com/${githubRepo}/releases/tag/${raw.tag_name}`,
        assets,
      });
    }

    let seenDesktop = false;
    for (const r of releases) {
      if (r.category === "desktop") {
        r.isLatest = !seenDesktop;
        seenDesktop = true;
      }
    }
  }

  // 3. 如果 GitHub API 失败或被限流，使用内置全量历史版本清单作为底座
  if (releases.length === 0) {
    const fallback = fallbackManifest as unknown as ReleasesManifest;
    if (fallback && Array.isArray(fallback.releases) && fallback.releases.length > 0) {
      releases = fallback.releases.map((rel) => ({
        ...rel,
        assets: (rel.assets || []).map((a) => ({
          ...a,
          isR2Cached: a.isR2Cached ?? rel.version === "0.10.2",
        })),
      }));
    }
  }

  // 3. 动态补全移动端（Android）最新发布条目，解决跨端版本号不一致导致翻找历史记录的问题
  // iOS 未签名 IPA 通道：默认无版本，只有 version.json 里出现 ios 节点才对外展示
  let iosVersion = "";
  let iosFileName = "";
  let iosSizeBytes = 4300000;
  let iosPublishedAt = "";
  let androidVersion = "0.1.0";
  let androidFileName = `Inkpoint_${androidVersion}.apk`;
  let androidSizeBytes = 45000000;
  let androidPublishedAt = "2026-09-16T12:00:00Z";

  let desktopVersion = "0.10.2";
  let desktopAssets: ReleaseAssetInfo[] = [];

  if (env.RELEASE_BUCKET) {
    const versionJsonObj = await env.RELEASE_BUCKET.get(`${app}/version.json`);
    if (versionJsonObj) {
      try {
        const vData = JSON.parse(await versionJsonObj.text()) as AppVersionManifest;
        if (vData.desktop?.version) {
          desktopVersion = vData.desktop.version;
          const dAssets = vData.desktop.assets;
          if (dAssets) {
            const list: ReleaseAssetInfo[] = [];
            if (dAssets.macos_arm64) {
              list.push({
                platform: "macos-arm64",
                platformLabel: "macOS (Apple Silicon) · DMG",
                fileName: dAssets.macos_arm64.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/macos/latest`,
                sizeBytes: dAssets.macos_arm64.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.macos_arm64.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.windows_x64) {
              list.push({
                platform: "windows-x64",
                platformLabel: "Windows (x64) · Setup",
                fileName: dAssets.windows_x64.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/windows/latest`,
                sizeBytes: dAssets.windows_x64.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.windows_x64.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.linux_appimage) {
              list.push({
                platform: "linux-appimage",
                platformLabel: "Linux (x86_64) · AppImage",
                fileName: dAssets.linux_appimage.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/linux/latest`,
                sizeBytes: dAssets.linux_appimage.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.linux_appimage.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.linux_appimage_arm64) {
              list.push({
                platform: "linux-appimage",
                platformLabel: "Linux (ARM64) · AppImage",
                fileName: dAssets.linux_appimage_arm64.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/linux-arm64/latest`,
                sizeBytes: dAssets.linux_appimage_arm64.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.linux_appimage_arm64.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.linux_deb) {
              list.push({
                platform: "linux-deb",
                platformLabel: "Linux (x86_64) · DEB",
                fileName: dAssets.linux_deb.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/${desktopVersion}/${dAssets.linux_deb.fileName}`,
                sizeBytes: dAssets.linux_deb.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.linux_deb.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (dAssets.linux_deb_arm64) {
              list.push({
                platform: "linux-deb",
                platformLabel: "Linux (ARM64) · DEB",
                fileName: dAssets.linux_deb_arm64.fileName,
                downloadUrl: `${baseUrl}/${app}/desktop/${desktopVersion}/${dAssets.linux_deb_arm64.fileName}`,
                sizeBytes: dAssets.linux_deb_arm64.sizeBytes || 0,
                formattedSize: formatBytes(dAssets.linux_deb_arm64.sizeBytes || 0),
                isR2Cached: true,
              });
            }
            if (list.length > 0) {
              desktopAssets = list;
            }
          }
        }
        if (vData.ios?.version) {
          iosVersion = vData.ios.version;
          if (vData.ios.ipa?.fileName) {
            iosFileName = vData.ios.ipa.fileName;
          }
          if (vData.ios.ipa?.sizeBytes) {
            iosSizeBytes = vData.ios.ipa.sizeBytes;
          }
          if (vData.updatedAt) {
            iosPublishedAt = vData.updatedAt;
          }
        }
        if (vData.android?.version) {
          androidVersion = vData.android.version;
          if (vData.android.apk?.fileName) {
            androidFileName = vData.android.apk.fileName;
          }
          if (vData.android.apk?.sizeBytes) {
            androidSizeBytes = vData.android.apk.sizeBytes;
          }
          if (vData.updatedAt) {
            androidPublishedAt = vData.updatedAt;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. 检查并确保清单中包含 R2 version.json 指定的桌面版本
  const existingDesktop = releases.find(
    (r) =>
      r.version === desktopVersion ||
      r.tagName === `v${desktopVersion}` ||
      r.tagName === `desktop-v${desktopVersion}`,
  );

  if (!existingDesktop) {
    releases.unshift({
      version: desktopVersion,
      tagName: `v${desktopVersion}`,
      publishedAt: new Date().toISOString(),
      isLatest: true,
      isPrerelease: false,
      category: "desktop",
      releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/v${desktopVersion}`,
      assets:
        desktopAssets.length > 0
          ? desktopAssets
          : [
              {
                platform: "macos-arm64",
                platformLabel: "macOS (Apple Silicon) · DMG",
                fileName: `Inkpoint_${desktopVersion}_aarch64.dmg`,
                downloadUrl: `${baseUrl}/${app}/desktop/macos/latest`,
                sizeBytes: 30680892,
                formattedSize: "29.3 MB",
                isR2Cached: true,
              },
              {
                platform: "windows-x64",
                platformLabel: "Windows (x64) · Setup",
                fileName: `Inkpoint_${desktopVersion}_x64-setup.exe`,
                downloadUrl: `${baseUrl}/${app}/desktop/windows/latest`,
                sizeBytes: 8072766,
                formattedSize: "7.7 MB",
                isR2Cached: true,
              },
              {
                platform: "linux-appimage",
                platformLabel: "Linux (x86_64) · AppImage",
                fileName: `Inkpoint_${desktopVersion}_amd64.AppImage`,
                downloadUrl: `${baseUrl}/${app}/desktop/linux/latest`,
                sizeBytes: 91474424,
                formattedSize: "87.2 MB",
                isR2Cached: true,
              },
            ],
    });

    for (let i = 1; i < releases.length; i++) {
      if (releases[i].category === "desktop") {
        releases[i].isLatest = false;
      }
    }
  }

  // 4. 枚举与合并全量 Android Release 列表（从 R2 Bucket、version.json 与已存在清单汇总）
  const androidMap = new Map<string, ReleaseInfo>();

  // A. 首先保留当前 releases 列表中已有的 Android 记录
  for (const r of releases) {
    if (r.category === "android" || r.assets.some((a) => a.platform === "android")) {
      androidMap.set(r.version, {
        ...r,
        category: "android",
      });
    }
  }

  // A2. 从内置 fallback 清单补充已知 Android 发布
  const fallback = fallbackManifest as unknown as ReleasesManifest;
  if (Array.isArray(fallback?.releases)) {
    for (const r of fallback.releases) {
      if (
        (r.category === "android" || r.assets?.some((a) => a.platform === "android")) &&
        !androidMap.has(r.version)
      ) {
        androidMap.set(r.version, {
          ...r,
          category: "android",
        });
      }
    }
  }

  // B. 扫描 R2 存储桶中物理存在的所有 Android APK 版本
  if (env.RELEASE_BUCKET && typeof env.RELEASE_BUCKET.list === "function") {
    try {
      const listRes = await env.RELEASE_BUCKET.list({ prefix: `${app}/android/` });
      if (Array.isArray(listRes?.objects)) {
        for (const obj of listRes.objects) {
          const match = obj.key.match(new RegExp(`^${app}/android/([^/]+)/([^/]+\\.apk)$`));
          if (match) {
            const v = match[1];
            const fileName = match[2];
            if (v !== "latest" && !fileName.includes("unaligned")) {
              const asset: ReleaseAssetInfo = {
                platform: "android",
                platformLabel: "Android · APK (Beta)",
                fileName,
                downloadUrl: `${baseUrl}/${app}/android/${v}/${fileName}`,
                sizeBytes: obj.size,
                formattedSize: formatBytes(obj.size),
                isR2Cached: true,
              };

              const existing = androidMap.get(v);
              if (!existing) {
                androidMap.set(v, {
                  version: v,
                  tagName: `android-v${v}`,
                  publishedAt: obj.uploaded ? obj.uploaded.toISOString() : new Date().toISOString(),
                  isLatest: false,
                  isPrerelease: true,
                  category: "android",
                  releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/android-v${v}`,
                  assets: [asset],
                });
              } else if (!existing.assets.some((a) => a.fileName === fileName)) {
                existing.assets.push(asset);
              }
            }
          }
        }
      }
    } catch {
      // 容灾忽略
    }
  }

  // C. 确保 version.json 中指定的最新 Android 版本也在 map 中
  if (androidVersion && !androidMap.has(androidVersion)) {
    androidMap.set(androidVersion, {
      version: androidVersion,
      tagName: `android-v${androidVersion}`,
      publishedAt: androidPublishedAt,
      isLatest: false,
      isPrerelease: true,
      category: "android",
      releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/android-v${androidVersion}`,
      assets: [
        {
          platform: "android",
          platformLabel: "Android · APK (Beta)",
          fileName: androidFileName,
          downloadUrl: `${baseUrl}/${app}/android/${androidVersion}/${androidFileName}`,
          sizeBytes: androidSizeBytes,
          formattedSize: formatBytes(androidSizeBytes),
          isR2Cached: true,
        },
      ],
    });
  }

  // D. 排序并标记最新版本
  const sortedAndroid = Array.from(androidMap.values()).toSorted((a, b) =>
    compareSemver(b.version, a.version),
  );

  for (let i = 0; i < sortedAndroid.length; i++) {
    sortedAndroid[i].isLatest = i === 0;
  }

  // E. 从 releases 中剔除旧的 Android 项，并将有序的全部 Android 版本追加进去
  releases = releases.filter(
    (r) => r.category !== "android" && !r.assets.some((a) => a.platform === "android"),
  );
  releases.push(...sortedAndroid);

  // F. iOS 归档：从清单里已有 ios 条目 + version.json 的 ios 节点重建（iOS 无 GitHub Release）
  const iosMap = new Map<string, ReleaseInfo>();
  for (const r of releases) {
    if (r.category === "ios" || r.assets?.some((a) => a.platform === "ios")) {
      iosMap.set(r.version, { ...r, category: "ios" });
    }
  }

  if (iosVersion && !iosMap.has(iosVersion)) {
    const fileName = iosFileName || `Inkpoint-${iosVersion}-unsigned.ipa`;
    iosMap.set(iosVersion, {
      version: iosVersion,
      tagName: `ios-ipa-v${iosVersion}`,
      publishedAt: iosPublishedAt || new Date().toISOString(),
      isLatest: false,
      isPrerelease: true,
      category: "ios",
      releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/ios-ipa-v${iosVersion}`,
      assets: [
        {
          platform: "ios",
          platformLabel: "iOS · 未签名 IPA（自签安装）",
          fileName,
          downloadUrl: `${baseUrl}/${app}/ios/${iosVersion}/${fileName}`,
          sizeBytes: iosSizeBytes,
          formattedSize: formatBytes(iosSizeBytes),
          isR2Cached: true,
        },
      ],
    });
  }

  const sortedIos = Array.from(iosMap.values()).toSorted((a, b) =>
    compareSemver(b.version, a.version),
  );

  for (let i = 0; i < sortedIos.length; i++) {
    sortedIos[i].isLatest = i === 0;
  }

  releases = releases.filter(
    (r) => r.category !== "ios" && !r.assets?.some((a) => a.platform === "ios"),
  );
  releases.push(...sortedIos);

  // 5. 计算各端最新版本与直达摘要
  const desktopRelease = releases.find((r) => r.category === "desktop");
  const topAndroid = sortedAndroid[0];
  const topIos = sortedIos[0];

  const latestDesktopVersion = desktopRelease?.version || releases[0]?.version || "0.10.2";
  const latestAndroidVersion = topAndroid?.version || androidVersion;
  const latestIosVersion = topIos?.version || iosVersion;

  return {
    app,
    updatedAt: new Date().toISOString(),
    total: releases.length,
    latestVersion: latestDesktopVersion,
    latestDesktopVersion,
    latestAndroidVersion,
    latestIosVersion,
    latestReleases: {
      desktop: {
        version: latestDesktopVersion,
        downloadUrl: `${baseUrl}/${app}/${latestDesktopVersion}/`,
        assets: desktopRelease?.assets || [],
      },
      android: {
        version: latestAndroidVersion,
        downloadUrl: `${baseUrl}/${app}/android/latest`,
        fileName: topAndroid?.assets?.[0]?.fileName || androidFileName,
        formattedSize: topAndroid?.assets?.[0]?.formattedSize || formatBytes(androidSizeBytes),
      },
      ios: latestIosVersion
        ? {
            version: latestIosVersion,
            downloadUrl: `${baseUrl}/${app}/ios/latest`,
            platformLabel: "iOS · 未签名 IPA（自签安装）",
            fileName:
              topIos?.assets?.[0]?.fileName ||
              iosFileName ||
              `Inkpoint-${latestIosVersion}-unsigned.ipa`,
            formattedSize: topIos?.assets?.[0]?.formattedSize || formatBytes(iosSizeBytes),
          }
        : undefined,
    },
    releases,
  };
}
