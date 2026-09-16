import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function computeSha256(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function mergeVersionManifest(existingManifest = {}, desktopData = {}) {
  const app = desktopData.app || existingManifest.app || "inkpoint";
  const updatedAt = new Date().toISOString();

  return {
    app,
    updatedAt,
    desktop: desktopData.desktop || existingManifest.desktop,
    android: existingManifest.android,
    ios: existingManifest.ios,
  };
}

function findFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const res = findFile(fullPath, predicate);
      if (res) return res;
    } else if (predicate(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

export async function runCli() {
  const version = process.env.RELEASE_VERSION;
  if (!version) {
    console.error("RELEASE_VERSION is required");
    process.exit(1);
  }

  const normalizedVersion = version.replace(/^v/, "");
  const artifactsDir = process.env.ARTIFACTS_DIR || "release-artifacts";
  const outputPath = process.env.OUTPUT_PATH || "dist-desktop/version.json";
  const distributionUrl = process.env.DISTRIBUTION_URL || "https://download.justdev.cn";
  const appName = process.env.APP_NAME || "inkpoint";
  const githubRepo = process.env.GITHUB_REPO || "wmasfoe/md-editor";

  // 1. 尝试拉取当前线上 version.json 以保留 android/ios 节点
  let existingManifest = {};
  try {
    const res = await fetch(`${distributionUrl}/api/${appName}/version.json`, {
      headers: { "User-Agent": "Inkpoint-Release-Script/1.0" },
    });
    if (res.ok) {
      existingManifest = await res.json();
      console.log(
        `✓ Fetched existing manifest from ${distributionUrl}/api/${appName}/version.json`,
      );
    }
  } catch (err) {
    console.warn(`Could not fetch remote version.json: ${err.message}. Using local baseline.`);
  }

  // 2. 扫描 artifacts 收集桌面产物信息

  const macArmDmg = findFile(
    artifactsDir,
    (n) =>
      n.endsWith(".dmg") && (n.includes("arm64") || n.includes("aarch64") || !n.includes("x64")),
  );
  const macX64Dmg = findFile(
    artifactsDir,
    (n) => n.endsWith(".dmg") && (n.includes("x64") || n.includes("x86_64")),
  );
  const winX64 = findFile(
    artifactsDir,
    (n) => n.endsWith(".exe") && (n.includes("x64") || !n.includes("arm64")),
  );
  const winArm64 = findFile(artifactsDir, (n) => n.endsWith(".exe") && n.includes("arm64"));
  const linuxAppImage = findFile(
    artifactsDir,
    (n) =>
      n.endsWith(".AppImage") &&
      (n.includes("amd64") || n.includes("x86_64") || !n.includes("arm64")),
  );
  const linuxDeb = findFile(
    artifactsDir,
    (n) =>
      n.endsWith(".deb") && (n.includes("amd64") || n.includes("x86_64") || !n.includes("arm64")),
  );

  const createAssetInfo = (filePath, defaultName, urlPlatform) => {
    const fileName = filePath ? path.basename(filePath) : defaultName;
    const sizeBytes = filePath ? fs.statSync(filePath).size : undefined;
    const sha256 = filePath ? computeSha256(filePath) : undefined;
    return {
      version: normalizedVersion,
      fileName,
      downloadUrl: `${distributionUrl}/${appName}/desktop/${urlPlatform}/latest`,
      sizeBytes,
      sha256,
    };
  };

  const desktop = {
    version: normalizedVersion,
    releaseNotesUrl: `https://github.com/${githubRepo}/releases/tag/v${normalizedVersion}`,
    assets: {
      macos_arm64: createAssetInfo(macArmDmg, `Inkpoint_${normalizedVersion}_aarch64.dmg`, "macos"),
      macos_x64: macX64Dmg
        ? createAssetInfo(macX64Dmg, `Inkpoint_${normalizedVersion}_x64.dmg`, "macos-x64")
        : undefined,
      windows_x64: createAssetInfo(
        winX64,
        `Inkpoint_${normalizedVersion}_x64-setup.exe`,
        "windows",
      ),
      windows_arm64: winArm64
        ? createAssetInfo(
            winArm64,
            `Inkpoint_${normalizedVersion}_arm64-setup.exe`,
            "windows-arm64",
          )
        : undefined,
      linux_appimage: createAssetInfo(
        linuxAppImage,
        `Inkpoint_${normalizedVersion}_x86_64.AppImage`,
        "linux",
      ),
      linux_deb: linuxDeb
        ? createAssetInfo(linuxDeb, `Inkpoint_${normalizedVersion}_amd64.deb`, "linux-deb")
        : undefined,
    },
  };

  const updatedManifest = mergeVersionManifest(existingManifest, { app: appName, desktop });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
  console.log(`✓ Updated multi-platform version manifest: ${outputPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
