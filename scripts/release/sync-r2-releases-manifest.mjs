import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_APP = process.env.APP_NAME || "inkpoint";
export const GITHUB_REPO = process.env.GITHUB_REPO || "wmasfoe/md-editor";
export const DISTRIBUTION_URL = process.env.DISTRIBUTION_URL || "https://download.justdev.cn";
export const BUCKET = process.env.R2_BUCKET_NAME || "inkpoint-releases";

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

function parseSemverComponents(v) {
  return String(v)
    .replace(/^v/i, "")
    .replace(/^android-v/i, "")
    .replace(/^mobile-v/i, "")
    .split(".")
    .map((num) => parseInt(num, 10) || 0);
}

export function compareSemver(a, b) {
  const pa = parseSemverComponents(a);
  const pb = parseSemverComponents(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export function getAndroidGitTags() {
  try {
    const stdout = execSync('git tag -l "android-v*"', {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return stdout
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.startsWith("android-v"));
  } catch {
    return [];
  }
}

/**
 * 构建完整的 ReleasesManifest
 */
export function transformGitHubReleases(
  rawReleases,
  app = DEFAULT_APP,
  baseUrl = DISTRIBUTION_URL,
  options = {},
) {
  const releases = [];
  const androidMap = new Map();

  // 1. 如果传入了已有的 Android releases 或历史清单，先载入
  if (Array.isArray(options.existingReleases)) {
    for (const r of options.existingReleases) {
      if (r.category === "android" || r.assets?.some((a) => a.platform === "android")) {
        androidMap.set(r.version, { ...r, category: "android" });
      }
    }
  }

  // 2. 如果传入了显式的 extraAndroidReleases，合并入 androidMap
  if (Array.isArray(options.extraAndroidReleases)) {
    for (const r of options.extraAndroidReleases) {
      if (r.version) {
        androidMap.set(r.version, { ...r, category: "android" });
      }
    }
  }

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
        isR2Cached: cleanVer === "0.10.2",
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

    if (category === "android") {
      androidMap.set(cleanVer, {
        version: cleanVer,
        tagName: tag,
        publishedAt: raw.published_at || new Date().toISOString(),
        isLatest: false,
        isPrerelease: Boolean(raw.prerelease),
        category: "android",
        releaseNotesUrl: raw.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
        assets,
      });
    } else {
      releases.push({
        version: cleanVer,
        tagName: tag,
        publishedAt: raw.published_at || new Date().toISOString(),
        isLatest: false,
        isPrerelease: Boolean(raw.prerelease),
        category: "desktop",
        releaseNotesUrl: raw.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
        assets,
      });
    }
  }

  // 排序并合并 Android Releases
  const sortedAndroid = Array.from(androidMap.values()).toSorted((a, b) =>
    compareSemver(b.version, a.version),
  );

  for (let i = 0; i < sortedAndroid.length; i++) {
    sortedAndroid[i].isLatest = i === 0;
  }

  releases.push(...sortedAndroid);

  // 计算最新桌面与移动端
  const desktopRelease = releases.find((r) => r.category === "desktop");
  const androidRelease = sortedAndroid[0];

  if (desktopRelease) {
    desktopRelease.isLatest = true;
  }

  const latestDesktopVersion = desktopRelease?.version || "0.10.2";
  const latestAndroidVersion = androidRelease?.version || "0.1.1";

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

export function getGitHubTokenSafe() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export async function runCli() {
  const token = getGitHubTokenSafe();
  console.log(`📦 Fetching full release history from GitHub repo: ${GITHUB_REPO}...`);
  const rawReleases = await fetchAllGitHubReleases(GITHUB_REPO, token);
  console.log(`✓ Fetched ${rawReleases.length} releases from GitHub.`);

  // 读取现有 fallback-releases.json 中的历史记录
  const fallbackPath = path.resolve("infra/distribution-worker/src/fallback-releases.json");
  let existingReleases = [];
  if (fs.existsSync(fallbackPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
      if (Array.isArray(prev.releases)) {
        existingReleases = prev.releases;
      }
    } catch {}
  }

  // 自动从本地 git tags 发现所有 Android tags (android-v*)
  const gitTags = getAndroidGitTags();
  const gitAndroidReleases = gitTags.map((tag) => {
    const cleanVer = tag.replace(/^android-v/, "");
    const fileName = `Inkpoint_${cleanVer}.apk`;
    return {
      version: cleanVer,
      tagName: tag,
      publishedAt: new Date().toISOString(),
      isLatest: false,
      isPrerelease: true,
      category: "android",
      releaseNotesUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`,
      assets: [
        {
          platform: "android",
          platformLabel: "Android · APK (Beta)",
          fileName,
          downloadUrl: `${DISTRIBUTION_URL}/${DEFAULT_APP}/android/${cleanVer}/${fileName}`,
          sizeBytes: 45000000,
          formattedSize: "43 MB",
          isR2Cached: true,
        },
      ],
    };
  });

  const manifest = transformGitHubReleases(rawReleases, DEFAULT_APP, DISTRIBUTION_URL, {
    existingReleases,
    extraAndroidReleases: gitAndroidReleases,
  });

  // 1. 保存到本地快照（作为 Worker 的安全 fallback）
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
