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
    // 与 Worker 侧保持一致：aarch64 同样视为 ARM64（不含 arm64 子串）。
    const isArm = lower.includes("arm64") || lower.includes("aarch64");
    return {
      platform: "linux-appimage",
      platformLabel: isArm ? "Linux (ARM64) · AppImage" : "Linux (x86_64) · AppImage",
    };
  }
  if (lower.endsWith(".deb")) {
    const isArm = lower.includes("arm64") || lower.includes("aarch64");
    return {
      platform: "linux-deb",
      platformLabel: isArm ? "Linux (ARM64) · DEB" : "Linux (x86_64) · DEB",
    };
  }
  if (lower.endsWith(".apk")) {
    return { platform: "android", platformLabel: "Android · APK" };
  }
  if (lower.endsWith(".ipa")) {
    return { platform: "ios", platformLabel: "iOS · 未签名 IPA（自签安装）" };
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".sig")) {
    return {
      platform: "updater",
      platformLabel: lower.endsWith(".sig") ? "Tauri 签名文件" : "Tauri 自动更新包",
    };
  }
  return { platform: "other", platformLabel: "其他附件" };
}

/** 版本号是否形如 `0.10.2` / `0.4.2-beta.sha…`（用于过滤历史清单里的非发行 tag 脏数据）。 */
function isPlausibleVersion(version) {
  return typeof version === "string" && /^\d+\.\d+/.test(version);
}

/**
 * 从 GitHub 拉取所有 Releases。
 *
 * 返回 `degraded` 标记：GitHub API 不可用时（典型场景：未带 token 被 403 限流）会提前中断，
 * 调用方必须据此保留既有清单里的历史版本，**不能**把「拉取失败」当成「历史上只有这些版本」。
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
  let degraded = false;
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`GitHub API releases page ${page} returned HTTP ${res.status}`);
      degraded = true;
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
  return { releases: all, degraded };
}

function parseSemverComponents(v) {
  return String(v)
    .replace(/^v/i, "")
    .replace(/^android-v/i, "")
    .replace(/^mobile-v/i, "")
    .replace(/^ios-ipa-v/i, "")
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
 * 构建 iOS 未签名 IPA 的清单条目。
 *
 * iOS 刻意不创建 GitHub Release（避免抢占仓库 Releases 页的 Latest 徽标），
 * 所以条目无法从 GitHub Releases 推导，只能：
 *   1. 由发版 workflow 通过 IOS_RELEASE_VERSION 注入当前版本；
 *   2. 从上一版线上 releases.json 里把历史 iOS 条目递推下来（见 fetchRemoteIosReleases）。
 * 这样可以避免历史 tag（例如从未上传过 R2 的 ios-ipa-v0.1.0）产出 404 下载链接。
 */
export function buildIosReleaseEntry(version, artifactsDir = "dist-mobile") {
  if (!version) {
    return null;
  }
  const cleanVersion = String(version)
    .replace(/^ios-ipa-v/, "")
    .replace(/^v/, "");
  const fileName = `Inkpoint-${cleanVersion}-unsigned.ipa`;
  const filePath = path.join(artifactsDir, fileName);
  const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 4300000;

  return {
    version: cleanVersion,
    tagName: `ios-ipa-v${cleanVersion}`,
    publishedAt: new Date().toISOString(),
    isLatest: false,
    isPrerelease: true,
    category: "ios",
    releaseNotesUrl: `https://github.com/${GITHUB_REPO}/releases/tag/ios-ipa-v${cleanVersion}`,
    assets: [
      {
        platform: "ios",
        platformLabel: "iOS · 未签名 IPA（自签安装）",
        fileName,
        downloadUrl: `${DISTRIBUTION_URL}/${DEFAULT_APP}/ios/${cleanVersion}/${fileName}`,
        sizeBytes,
        formattedSize: formatBytes(sizeBytes),
        isR2Cached: true,
      },
    ],
  };
}

/**
 * 从线上清单取回已有发行版条目（默认：`/api/<app>/releases`）。
 *
 * 这是历史版本的第二道来源：仓库里的 `fallback-releases.json` 只在手动提交时更新，
 * 而线上清单由每次发版同步，更新得多。
 */
export async function fetchRemoteReleases(baseUrl = DISTRIBUTION_URL, app = DEFAULT_APP) {
  try {
    const res = await fetch(`${baseUrl}/api/${app}/releases`, {
      headers: { "User-Agent": "Inkpoint-Sync-Releases/1.0" },
    });
    if (!res.ok) {
      console.warn(`Remote manifest returned HTTP ${res.status}; skip history merge.`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data.releases) ? data.releases : [];
  } catch (err) {
    // 边缘/WAF 瞬断很常见（尤其同一出口连续请求时），重试一次再放弃
    console.warn(`Remote manifest fetch failed (${err?.message ?? err}); retrying once...`);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const res = await fetch(`${baseUrl}/api/${app}/releases`, {
        headers: { "User-Agent": "Inkpoint-Sync-Releases/1.0" },
      });
      if (!res.ok) {
        console.warn(`Remote manifest retry returned HTTP ${res.status}; skip history merge.`);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data.releases) ? data.releases : [];
    } catch (retryErr) {
      console.warn(`Remote manifest retry failed: ${retryErr?.message ?? retryErr}`);
      return [];
    }
  }
}

/**
 * 历史版本量护栏。
 *
 * 新清单的桌面端 / 移动端条目数不得少于基线（线上清单 ∪ 仓库 fallback）；否则视为
 * 「拉取降级或构建异常」，调用方必须跳过写入与上传，而不是把历史覆写成更小的集合。
 * 主动下架版本时用 `allowShrink` 显式放行。
 */
export function evaluateReleaseHistoryShrink({
  baselineReleases,
  nextManifest,
  allowShrink = false,
}) {
  const baseline = countReleaseGroups(baselineReleases ?? []);
  const next = countReleaseGroups(nextManifest?.releases ?? []);
  const shrinkages = [];
  for (const group of ["desktop", "mobile"]) {
    if (next[group] < baseline[group]) {
      shrinkages.push({ group, from: baseline[group], to: next[group] });
    }
  }
  return {
    ok: allowShrink || shrinkages.length === 0,
    allowShrink,
    baseline,
    next,
    shrinkages,
  };
}

/** 按「桌面端 / 移动端」分组统计去重版本数（同版本重复条目只算一次，非版本号脏条目不计入）。 */
function countReleaseGroups(releases) {
  const seen = { desktop: new Set(), mobile: new Set() };
  for (const release of releases) {
    if (!isPlausibleVersion(release?.version)) {
      continue;
    }
    if (release?.category === "desktop") {
      seen.desktop.add(release.version);
    } else if (release?.category === "android" || release?.category === "ios") {
      seen.mobile.add(`${release.category}:${release.version}`);
    }
  }
  return { desktop: seen.desktop.size, mobile: seen.mobile.size };
}

/**
 * 从线上清单取回历史 iOS 条目（best-effort）。
 * iOS 的历史版本唯一来源就是上一版分发清单，因此必须递推保留。
 */
export async function fetchRemoteIosReleases(baseUrl = DISTRIBUTION_URL, app = DEFAULT_APP) {
  const releases = await fetchRemoteReleases(baseUrl, app);
  return releases.filter((release) => release.category === "ios");
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
  const iosMap = new Map();

  // 1. 如果传入了已有的 Android releases 或历史清单，先载入
  // 只接受形如 `0.10.2` / `0.4.2-beta.sha…` 的版本号：历史清单里曾混入过
  // `utools-v0.1.1` 这类非桌面 tag（脚本早期缺 tag 过滤），合并时必须清洗掉。
  if (Array.isArray(options.existingReleases)) {
    for (const r of options.existingReleases) {
      if (!isPlausibleVersion(r?.version)) {
        continue;
      }
      if (r.category === "android" || r.assets?.some((a) => a.platform === "android")) {
        androidMap.set(r.version, { ...r, category: "android" });
      }
      if (r.category === "ios" || r.assets?.some((a) => a.platform === "ios")) {
        iosMap.set(r.version, { ...r, category: "ios" });
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

  // 2.1 同理合并显式的 extraIosReleases（iOS 无 GitHub Release，只能由 tag + R2 产物推导）
  if (Array.isArray(options.extraIosReleases)) {
    for (const r of options.extraIosReleases) {
      if (!r || !r.version) {
        continue;
      }
      if (r.version) {
        iosMap.set(r.version, { ...r, category: "ios" });
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
    const hasIos = tag.startsWith("ios-ipa-v") || assets.some((a) => a.platform === "ios");
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

    const category = hasDesktop ? "desktop" : hasAndroid ? "android" : hasIos ? "ios" : "";

    // 过滤 utools-v* / web-v* / 未知 tag：这些发布既不属于桌面端也不属于移动端，
    // 但它们的附件会被 matchPlatform 归为 "other"，早期版本因此被当成桌面端条目写进清单
    // （Worker 侧一直有同样的过滤，脚本侧缺失）。
    const isDesktopTag = tag.startsWith("desktop-v") || /^v\d/.test(tag);
    if (!category && !isDesktopTag) {
      continue;
    }

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
    } else if (category === "ios") {
      iosMap.set(cleanVer, {
        version: cleanVer,
        tagName: tag,
        publishedAt: raw.published_at || new Date().toISOString(),
        isLatest: false,
        isPrerelease: Boolean(raw.prerelease),
        category: "ios",
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

  // 2.2 合并历史桌面端条目
  // GitHub 拉取失败（403 限流）或被截断时，桌面端条目曾因此归零 —— 线上 releases.json
  // 被覆写后下载中心就只剩 version.json 里当前那一个版本。这里以已有清单
  // （线上 releases.json + 仓库 fallback）补齐历史，并按语义化版本降序排列，
  // 保证「拉取失败」不会缩小历史。
  const desktopVersions = new Set(releases.map((r) => r.version));
  const historyDesktop = [];
  for (const r of options.existingReleases ?? []) {
    if (
      r.category !== "desktop" ||
      desktopVersions.has(r.version) ||
      !isPlausibleVersion(r.version)
    ) {
      continue;
    }
    desktopVersions.add(r.version);
    historyDesktop.push({ ...r, isLatest: false, category: "desktop" });
  }
  historyDesktop.sort((a, b) => compareSemver(b.version, a.version));
  releases.push(...historyDesktop);

  // 排序并合并 Android Releases
  const sortedAndroid = Array.from(androidMap.values()).toSorted((a, b) =>
    compareSemver(b.version, a.version),
  );

  for (let i = 0; i < sortedAndroid.length; i++) {
    sortedAndroid[i].isLatest = i === 0;
  }

  releases.push(...sortedAndroid);

  // 排序并合并 iOS Releases（未签名 IPA 通道）
  const sortedIos = Array.from(iosMap.values()).toSorted((a, b) =>
    compareSemver(b.version, a.version),
  );

  for (let i = 0; i < sortedIos.length; i++) {
    sortedIos[i].isLatest = i === 0;
  }

  releases.push(...sortedIos);

  // 计算最新桌面与移动端
  const desktopRelease = releases.find((r) => r.category === "desktop");
  const androidRelease = sortedAndroid[0];
  const iosRelease = sortedIos[0];

  if (desktopRelease) {
    desktopRelease.isLatest = true;
  }

  const latestDesktopVersion = desktopRelease?.version || "0.10.2";
  const latestAndroidVersion = androidRelease?.version || "0.1.1";
  const latestIosVersion = iosRelease?.version || "";

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
        fileName: androidRelease?.assets?.[0]?.fileName || `Inkpoint_${latestAndroidVersion}.apk`,
        formattedSize: androidRelease?.assets?.[0]?.formattedSize || "43 MB",
      },
      ios: {
        version: latestIosVersion,
        downloadUrl: `${baseUrl}/${app}/ios/latest`,
        platformLabel: "iOS · 未签名 IPA（自签安装）",
        fileName:
          iosRelease?.assets?.[0]?.fileName ||
          (latestIosVersion ? `Inkpoint-${latestIosVersion}-unsigned.ipa` : ""),
        formattedSize: iosRelease?.assets?.[0]?.formattedSize || "4.3 MB",
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
  if (!token) {
    console.warn(
      "⚠️ 未检测到 GITHUB_TOKEN / GH_TOKEN：GitHub API 匿名调用极易 403 限流，历史版本将只能依赖线上清单与仓库 fallback 保留。",
    );
  }
  console.log(`📦 Fetching full release history from GitHub repo: ${GITHUB_REPO}...`);
  const { releases: rawReleases, degraded } = await fetchAllGitHubReleases(GITHUB_REPO, token);
  console.log(`✓ Fetched ${rawReleases.length} releases from GitHub.`);
  if (degraded) {
    console.warn(
      "⚠️ GitHub Releases 拉取不完整（限流/网络异常）：本次清单将合并线上清单与仓库 fallback 的历史版本，并在护栏下拒绝缩小历史。",
    );
  }

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

  // 线上清单历史：比仓库内 fallback 更新，优先级更高（同样的版本以线上条目为准）
  const remoteReleases = await fetchRemoteReleases();
  console.log(`✓ Fetched ${remoteReleases.length} releases from live manifest.`);

  const manifest = transformGitHubReleases(rawReleases, DEFAULT_APP, DISTRIBUTION_URL, {
    existingReleases: [...existingReleases, ...remoteReleases],
    extraAndroidReleases: gitAndroidReleases,
    extraIosReleases: [
      buildIosReleaseEntry(process.env.IOS_RELEASE_VERSION),
      ...(await fetchRemoteIosReleases()),
    ].filter(Boolean),
  });

  // 历史护栏：任何原因导致桌面端/移动端历史变少时，拒绝写入与上传（线上清单保持原样）。
  // 典型触发场景：GitHub API 403 限流使桌面端条目归零。
  const allowShrink =
    process.argv.includes("--allow-history-shrink") ||
    process.env.ALLOW_RELEASE_HISTORY_SHRINK === "true";
  const guard = evaluateReleaseHistoryShrink({
    baselineReleases: [...remoteReleases, ...existingReleases],
    nextManifest: manifest,
    allowShrink,
  });
  if (!guard.ok) {
    console.error(
      `❌ 历史版本护栏拦截：${guard.shrinkages
        .map((s) => `${s.group} ${s.from} → ${s.to}`)
        .join(
          "；",
        )}（基线：desktop ${guard.baseline.desktop} / mobile ${guard.baseline.mobile}，本次：desktop ${guard.next.desktop} / mobile ${guard.next.mobile}）`,
    );
    console.error(
      "   已跳过本地 fallback 写入与 R2 上传，线上清单保持原样。若确认要主动下架历史版本，请加 --allow-history-shrink 或设置 ALLOW_RELEASE_HISTORY_SHRINK=true。",
    );
    return;
  }

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
