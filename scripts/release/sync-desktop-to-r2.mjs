import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { generateR2UpdaterManifest } from "./write-r2-updater-manifest.mjs";
import { computeSha256, mergeVersionManifest } from "./update-r2-version-manifest.mjs";

const BUCKET = process.env.R2_BUCKET_NAME || "inkpoint-releases";
const APP_NAME = "inkpoint";
const DISTRIBUTION_URL = "https://download.justdev.cn";

async function main() {
  const versionArg =
    process.argv.find((a) => a.startsWith("--version="))?.split("=")[1] || "0.10.2";
  const version = versionArg.replace(/^v/, "");
  const tag = `md-editor-v${version}`;

  console.log(`📦 Fetching release info for ${tag} from wmasfoe/homebrew-tap...`);
  const releaseRes = await fetch(
    `https://api.github.com/repos/wmasfoe/homebrew-tap/releases/tags/${tag}`,
    { headers: { "User-Agent": "Inkpoint-Sync/1.0" } },
  );

  if (!releaseRes.ok) {
    throw new Error(`Failed to fetch release ${tag}: HTTP ${releaseRes.status}`);
  }

  const release = await releaseRes.json();
  const tmpDir = path.resolve("scratch/sync-desktop");
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`📥 Downloading release assets into ${tmpDir}...`);
  for (const asset of release.assets) {
    const dest = path.join(tmpDir, asset.name);
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== asset.size) {
      console.log(`  Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)...`);
      const res = await fetch(asset.browser_download_url);
      if (!res.ok) {
        throw new Error(`Failed to download ${asset.name}: HTTP ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buffer);
      console.log(`  ✓ Saved ${asset.name}`);
    } else {
      console.log(`  ✓ Already downloaded: ${asset.name}`);
    }
  }

  console.log(`🚀 Uploading desktop artifacts to Cloudflare R2 (${BUCKET})...`);
  for (const asset of release.assets) {
    const localPath = path.join(tmpDir, asset.name);
    const r2Key = `${APP_NAME}/desktop/${version}/${asset.name}`;
    console.log(`  Uploading ${r2Key}...`);
    execSync(`npx wrangler r2 object put "${BUCKET}/${r2Key}" --file "${localPath}" --remote`, {
      stdio: "inherit",
    });
  }

  // 上传最新别名
  const dmgFile = path.join(tmpDir, `Inkpoint_${version}_aarch64.dmg`);
  if (fs.existsSync(dmgFile)) {
    console.log(`  Uploading latest aliases for macOS DMG...`);
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${APP_NAME}/desktop/macos/latest.dmg" --file "${dmgFile}" --remote`,
      { stdio: "inherit" },
    );
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${APP_NAME}/desktop/latest.dmg" --file "${dmgFile}" --remote`,
      { stdio: "inherit" },
    );
  }

  const exeFile = path.join(tmpDir, `Inkpoint_${version}_x64-setup.exe`);
  if (fs.existsSync(exeFile)) {
    console.log(`  Uploading latest alias for Windows Setup...`);
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${APP_NAME}/desktop/windows/latest.exe" --file "${exeFile}" --remote`,
      { stdio: "inherit" },
    );
  }

  const appImageFile = path.join(tmpDir, `Inkpoint_${version}_amd64.AppImage`);
  if (fs.existsSync(appImageFile)) {
    console.log(`  Uploading latest alias for Linux AppImage...`);
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${APP_NAME}/desktop/linux/latest.AppImage" --file "${appImageFile}" --remote`,
      { stdio: "inherit" },
    );
  }

  // 生成并上传 updater.json
  const sigFile = path.join(tmpDir, "Inkpoint.app.tar.gz.sig");
  const macSig = fs.existsSync(sigFile) ? fs.readFileSync(sigFile, "utf-8") : undefined;
  const updaterManifest = generateR2UpdaterManifest({
    version,
    distributionUrl: DISTRIBUTION_URL,
    appName: APP_NAME,
    macTarName: "Inkpoint.app.tar.gz",
    macSignature: macSig,
  });

  const updaterPath = path.join(tmpDir, "updater.json");
  fs.writeFileSync(updaterPath, JSON.stringify(updaterManifest, null, 2));
  console.log(`  Uploading ${APP_NAME}/desktop/updater.json...`);
  execSync(
    `npx wrangler r2 object put "${BUCKET}/${APP_NAME}/desktop/updater.json" --file "${updaterPath}" --remote`,
    { stdio: "inherit" },
  );

  // 合并并上传 version.json
  let existingManifest = {};
  try {
    const res = await fetch(`${DISTRIBUTION_URL}/api/${APP_NAME}/version.json`);
    if (res.ok) {
      existingManifest = await res.json();
    }
  } catch (err) {
    console.warn("Could not fetch remote version.json:", err.message);
  }

  const desktop = {
    version,
    releaseNotesUrl: `https://github.com/wmasfoe/md-editor/releases/tag/v${version}`,
    assets: {
      macos_arm64: {
        version,
        fileName: `Inkpoint_${version}_aarch64.dmg`,
        downloadUrl: `${DISTRIBUTION_URL}/${APP_NAME}/desktop/macos/latest`,
        sizeBytes: fs.existsSync(dmgFile) ? fs.statSync(dmgFile).size : undefined,
        sha256: computeSha256(dmgFile),
      },
      windows_x64: {
        version,
        fileName: `Inkpoint_${version}_x64-setup.exe`,
        downloadUrl: `${DISTRIBUTION_URL}/${APP_NAME}/desktop/windows/latest`,
        sizeBytes: fs.existsSync(exeFile) ? fs.statSync(exeFile).size : undefined,
        sha256: computeSha256(exeFile),
      },
      linux_appimage: {
        version,
        fileName: `Inkpoint_${version}_amd64.AppImage`,
        downloadUrl: `${DISTRIBUTION_URL}/${APP_NAME}/desktop/linux/latest`,
        sizeBytes: fs.existsSync(appImageFile) ? fs.statSync(appImageFile).size : undefined,
        sha256: computeSha256(appImageFile),
      },
      linux_deb: {
        version,
        fileName: `Inkpoint_${version}_amd64.deb`,
        downloadUrl: `${DISTRIBUTION_URL}/${APP_NAME}/desktop/${version}/Inkpoint_${version}_amd64.deb`,
        sizeBytes: fs.existsSync(path.join(tmpDir, `Inkpoint_${version}_amd64.deb`))
          ? fs.statSync(path.join(tmpDir, `Inkpoint_${version}_amd64.deb`)).size
          : undefined,
        sha256: computeSha256(path.join(tmpDir, `Inkpoint_${version}_amd64.deb`)),
      },
    },
  };

  const updatedVersionManifest = mergeVersionManifest(existingManifest, {
    app: APP_NAME,
    desktop,
  });

  const versionPath = path.join(tmpDir, "version.json");
  fs.writeFileSync(versionPath, JSON.stringify(updatedVersionManifest, null, 2));
  console.log(`  Uploading ${APP_NAME}/version.json...`);
  execSync(
    `npx wrangler r2 object put "${BUCKET}/${APP_NAME}/version.json" --file "${versionPath}" --remote`,
    { stdio: "inherit" },
  );

  // 刷新全网边缘缓存，使动态渲染最新版本即时生效
  console.log(`🧹 Purging download edge cache...`);
  try {
    execSync(`node scripts/release/purge-download-cache.mjs`, { stdio: "inherit" });
  } catch (purgeErr) {
    console.warn("Could not purge download cache:", purgeErr.message);
  }

  console.log("🎉 Successfully synchronized all Desktop artifacts, manifests and purged cache!");
}

main().catch((err) => {
  console.error("Sync error:", err);
  process.exit(1);
});
