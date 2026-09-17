import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APP,
  GITHUB_REPO,
  fetchAllGitHubReleases,
  getGitHubTokenSafe,
} from "./sync-r2-releases-manifest.mjs";

const BUCKET = process.env.R2_BUCKET_NAME || "inkpoint-releases";
const APP_NAME = process.env.APP_NAME || DEFAULT_APP || "inkpoint";

/**
 * 检查 R2 桶中某对象是否已经存在
 */
export function checkR2ObjectExists(bucket, r2Key) {
  try {
    execSync(`npx wrangler r2 object get "${bucket}/${r2Key}" --remote`, {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 同步单条 Asset 到 R2 存储桶（单文件流水线：下载 -> 上传 -> 立即清理）
 */
export async function syncSingleAssetToR2({
  asset,
  version,
  isAndroid,
  bucket = BUCKET,
  app = APP_NAME,
  dryRun = false,
  tmpDir,
}) {
  const device = isAndroid ? "android" : "desktop";
  const r2Key = `${app}/${device}/${version}/${asset.name}`;

  if (dryRun) {
    console.log(
      `[dry-run] Would sync ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB) -> ${r2Key}`,
    );
    return { status: "dry-run", r2Key };
  }

  // 1. 检查 R2 中是否已存在相同文件，避免重复传输
  const exists = checkR2ObjectExists(bucket, r2Key);
  if (exists) {
    console.log(`  ✓ Already in R2: ${r2Key} (skipped)`);
    return { status: "skipped", r2Key };
  }

  // 2. 下载单文件到临时目录
  fs.mkdirSync(tmpDir, { recursive: true });
  const localFilePath = path.join(tmpDir, asset.name);

  try {
    console.log(`  📥 Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)...`);
    const downloadRes = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "Inkpoint-History-Sync/1.0" },
    });
    if (!downloadRes.ok) {
      throw new Error(`Failed to download ${asset.name}: HTTP ${downloadRes.status}`);
    }

    const fileBuffer = Buffer.from(await downloadRes.arrayBuffer());
    fs.writeFileSync(localFilePath, fileBuffer);

    // 3. 上传到 Cloudflare R2
    console.log(`  🚀 Uploading -> ${r2Key}...`);
    execSync(`npx wrangler r2 object put "${bucket}/${r2Key}" --file "${localFilePath}" --remote`, {
      stdio: "inherit",
    });

    return { status: "uploaded", r2Key };
  } finally {
    // 4. 立即删除临时文件，杜绝磁盘暴涨
    if (fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch {
        // 忽略清理临时文件失败
      }
    }
  }
}

/**
 * 主执行函数
 */
export async function runSyncHistory(options = {}) {
  const token = options.token || getGitHubTokenSafe();
  const repo = options.repo || GITHUB_REPO;
  const bucket = options.bucket || BUCKET;
  const dryRun = Boolean(options.dryRun);
  const limit = options.limit ? Number(options.limit) : Infinity;
  const startFrom = options.startFrom || null;

  console.log(`🔍 Fetching full release history from GitHub (${repo})...`);
  const rawReleases = await fetchAllGitHubReleases(repo, token);
  console.log(`✓ Fetched ${rawReleases.length} releases.`);

  const tmpDir = path.resolve("scratch/sync-history-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  let totalProcessed = 0;
  let totalUploaded = 0;
  let totalSkipped = 0;
  let hasReachedStart = !startFrom;

  for (const rel of rawReleases) {
    const tag = rel.tag_name || "";
    const cleanVer = tag
      .replace(/^v/, "")
      .replace(/^desktop-v/, "")
      .replace(/^android-v/, "")
      .replace(/^mobile-v/, "");

    if (!hasReachedStart) {
      if (cleanVer === startFrom || tag === startFrom) {
        hasReachedStart = true;
      } else {
        continue;
      }
    }

    if (totalProcessed >= limit) {
      console.log(`🛑 Reached batch limit of ${limit} releases.`);
      break;
    }

    const isAndroid = tag.startsWith("android-v") || tag.startsWith("mobile-v");
    const assets = rel.assets || [];

    if (assets.length === 0) {
      continue;
    }

    console.log(`\n📦 Processing release: ${tag} (${cleanVer}) [${assets.length} assets]`);

    for (const asset of assets) {
      try {
        const result = await syncSingleAssetToR2({
          asset,
          version: cleanVer,
          isAndroid,
          bucket,
          dryRun,
          tmpDir,
        });

        if (result.status === "uploaded") {
          totalUploaded++;
        } else if (result.status === "skipped") {
          totalSkipped++;
        }
      } catch (err) {
        console.error(`  ❌ Failed to sync asset ${asset.name}:`, err.message);
      }
    }

    totalProcessed++;
  }

  // 清理临时目录
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }

  console.log(`\n========================================`);
  console.log(`🎉 Sync summary:`);
  console.log(`   Processed Releases: ${totalProcessed}`);
  console.log(`   Uploaded Assets:    ${totalUploaded}`);
  console.log(`   Skipped Existing:   ${totalSkipped}`);
  console.log(`========================================\n`);

  if (!dryRun && totalUploaded > 0) {
    console.log(`📋 Updating and uploading full releases manifest to R2...`);
    try {
      execSync(`node scripts/release/sync-r2-releases-manifest.mjs --upload`, { stdio: "inherit" });
    } catch (e) {
      console.warn("Could not auto-update manifest:", e.message);
    }

    console.log(`🧹 Purging edge download cache...`);
    try {
      execSync(`node scripts/release/purge-download-cache.mjs`, { stdio: "inherit" });
    } catch (e) {
      console.warn("Could not purge edge cache:", e.message);
    }
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
  const startArg = args.find((a) => a.startsWith("--start-from="))?.split("=")[1];

  runSyncHistory({
    dryRun,
    limit: limitArg ? parseInt(limitArg, 10) : undefined,
    startFrom: startArg,
  }).catch((err) => {
    console.error("History sync error:", err);
    process.exit(1);
  });
}
