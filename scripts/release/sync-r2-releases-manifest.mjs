import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_APP = process.env.APP_NAME || "inkpoint";
const GITHUB_REPO = process.env.GITHUB_REPO || "wmasfoe/md-editor";
const DISTRIBUTION_URL = process.env.DISTRIBUTION_URL || "https://download.justdev.cn";
const BUCKET = process.env.R2_BUCKET_NAME || "inkpoint-releases";

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function matchPlatform(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".dmg")) {
    if (lower.includes("x64") || lower.includes("x86_64") || lower.includes("intel")) {
      return { platform: "macos-x64", platformLabel: "macOS (Intel) · DMG" };
    }
    return { platform: "macos-arm64", platformLabel: "macOS (Apple Silicon) · DMG" };
  }
  if (lower.endsWith(".exe")) {
    if (lower.includes("arm64")) {
      return { platform: "windows-arm64", platformLabel: "Windows (ARM64) · Setup" };
    }
    return { platform: "windows-x64", platformLabel: "Windows (x64) · Setup" };
  }
  if (lower.endsWith(".appimage")) {
    return {
      platform: "linux-appimage",
      platformLabel: lower.includes("arm64")
        ? "Linux (ARM64) · AppImage"
        : "Linux (x86_64) · AppImage",
    };
  }
  if (lower.endsWith(".deb")) {
    return {
      platform: "linux-deb",
      platformLabel: lower.includes("arm64") ? "Linux (ARM64) · DEB" : "Linux (x86_64) · DEB",
    };
  }
  if (lower.endsWith(".apk")) {
    return { platform: "android", platformLabel: "Android · APK" };
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".sig")) {
    return {
      platform: "updater",
      platformLabel: lower.endsWith(".sig") ? "Tauri 签名文件" : "Tauri 自动更新包",
    };
  }
  return { platform: "other", platformLabel: "其他附件" };
}

/**
 * 从 GitHub 拉取所有 Releases
 */
export async function fetchAllGitHubReleases(repo, token) {
  const headers = {
    "User-Agent": "Inkpoint-Sync-Releases/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const all = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`GitHub API releases page ${page} returned HTTP ${res.status}`);
      break;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }
    all.push(...data);
    if (data.length < 100) {
      break;
    }
    page++;
  }
  return all;
}

/**
 * 构建完整的 ReleasesManifest
 */
export function transformGitHubReleases(
  rawReleases,
  app = DEFAULT_APP,
  baseUrl = DISTRIBUTION_URL,
) {
  const releases = [];

  for (const raw of rawReleases) {
    const tag = raw.tag_name || "";
    const isAndroidTag = tag.startsWith("android-v") || tag.startsWith("mobile-v");
    const cleanVer = tag
      .replace(/^v/, "")
      .replace(/^desktop-v/, "")
      .replace(/^android-v/, "")
      .replace(/^mobile-v/, "");

    const assets = [];
    for (const asset of raw.assets || []) {
      const { platform, platformLabel } = matchPlatform(asset.name);
      assets.push({
        platform,
        platformLabel,
        fileName: asset.name,
        downloadUrl: `${baseUrl}/${app}/${cleanVer}/${encodeURIComponent(asset.name)}`,
        sizeBytes: asset.size,
        formattedSize: formatBytes(asset.size),
      });
    }

    const hasAndroid = isAndroidTag || assets.some((a) => a.platform === "android");
    const hasDesktop = assets.some((a) =>
      [
        "macos-arm64",
        "macos-x64",
        "windows-x64",
        "windows-arm64",
        "linux-appimage",
        "linux-deb",
      ].includes(a.platform),
    );

    const category = hasAndroid && !hasDesktop ? "android" : "desktop";

    releases.push({
      version: cleanVer,
      tagName: tag,
      publishedAt: raw.published_at || new Date().toISOString(),
      isLatest: false,
      isPrerelease: Boolean(raw.prerelease),
      category,
      releaseNotesUrl: raw.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
      assets,
    });
  }

  // 计算最新桌面与移动端
  const desktopRelease = releases.find((r) => r.category === "desktop");
  const androidRelease = releases.find((r) => r.category === "android");

  if (desktopRelease) {
    desktopRelease.isLatest = true;
  }
  if (androidRelease && !desktopRelease) {
    androidRelease.isLatest = true;
  }

  const latestDesktopVersion = desktopRelease?.version || "0.10.2";
  const latestAndroidVersion = androidRelease?.version || "0.1.0";

  return {
    app,
    updatedAt: new Date().toISOString(),
    total: releases.length,
    latestVersion: latestDesktopVersion,
    latestDesktopVersion,
    latestAndroidVersion,
    latestReleases: {
      desktop: {
        version: latestDesktopVersion,
        downloadUrl: `${baseUrl}/${app}/${latestDesktopVersion}/`,
        assets: desktopRelease?.assets || [],
      },
      android: {
        version: latestAndroidVersion,
        downloadUrl: `${baseUrl}/${app}/android/latest`,
        fileName: androidRelease?.assets?.[0]?.fileName || `Inkpoint_${latestAndroidVersion}.apk`,
        formattedSize: androidRelease?.assets?.[0]?.formattedSize || "43 MB",
      },
    },
    releases,
  };
}

export async function runCli() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  console.log(`📦 Fetching full release history from GitHub repo: ${GITHUB_REPO}...`);
  const rawReleases = await fetchAllGitHubReleases(GITHUB_REPO, token);
  console.log(`✓ Fetched ${rawReleases.length} releases from GitHub.`);

  const manifest = transformGitHubReleases(rawReleases, DEFAULT_APP, DISTRIBUTION_URL);

  // 1. 保存到本地快照（作为 Worker 的安全 fallback）
  const fallbackPath = path.resolve("infra/distribution-worker/src/fallback-releases.json");
  fs.writeFileSync(fallbackPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ Saved fallback manifest to: ${fallbackPath}`);

  // 2. 如果开启上传或提供了 bucket，直接同步到 R2
  const shouldUpload = process.argv.includes("--upload") || process.env.UPLOAD_TO_R2 === "true";
  if (shouldUpload) {
    const tmpPath = path.resolve("scratch/releases.json");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));

    console.log(`🚀 Uploading ${DEFAULT_APP}/releases.json to Cloudflare R2 (${BUCKET})...`);
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${DEFAULT_APP}/releases.json" --file "${tmpPath}" --content-type "application/json" --remote`,
      { stdio: "inherit" },
    );
    console.log(`✅ Successfully uploaded ${DEFAULT_APP}/releases.json to R2!`);
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isDirectRun) {
  runCli().catch((err) => {
    console.error("Sync releases error:", err);
    process.exit(1);
  });
}
