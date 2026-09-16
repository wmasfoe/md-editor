import fs from "node:fs";
import path from "node:path";

export function generateR2UpdaterManifest({
  version,
  distributionUrl = "https://download.justdev.cn",
  appName = "inkpoint",
  macTarName = "Inkpoint.app.tar.gz",
  macSignature,
  winZipName,
  winSignature,
  notes,
}) {
  if (!version) {
    throw new Error("Missing version");
  }

  const normalizedVersion = version.replace(/^v/, "");
  const platforms = {};

  if (macSignature) {
    platforms["darwin-aarch64"] = {
      signature: macSignature.trim(),
      url: `${distributionUrl}/${appName}/desktop/${normalizedVersion}/${macTarName}`,
    };
  }

  if (winZipName && winSignature) {
    platforms["windows-x86_64"] = {
      signature: winSignature.trim(),
      url: `${distributionUrl}/${appName}/desktop/${normalizedVersion}/${winZipName}`,
    };
  }

  return {
    version: normalizedVersion,
    notes: notes || `Inkpoint ${normalizedVersion}`,
    platforms,
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

export function runCli() {
  const version = process.env.RELEASE_VERSION;
  if (!version) {
    console.error("RELEASE_VERSION is required");
    process.exit(1);
  }

  const artifactsDir = process.env.ARTIFACTS_DIR || "release-artifacts";
  const outputPath = process.env.OUTPUT_PATH || "dist-desktop/updater.json";
  const distributionUrl = process.env.DISTRIBUTION_URL || "https://download.justdev.cn";
  const appName = process.env.APP_NAME || "inkpoint";

  let macTarName = "Inkpoint.app.tar.gz";
  let macSignature = process.env.MAC_UPDATER_SIGNATURE;
  let winZipName;
  let winSignature = process.env.WIN_UPDATER_SIGNATURE;

  if (fs.existsSync(artifactsDir)) {
    const macFile = findFile(artifactsDir, (n) => n.endsWith(".app.tar.gz"));
    if (macFile) {
      macTarName = path.basename(macFile);
      const sigFile = `${macFile}.sig`;
      if (fs.existsSync(sigFile)) {
        macSignature = fs.readFileSync(sigFile, "utf-8");
      }
    }

    const winFile = findFile(
      artifactsDir,
      (n) => n.includes("x64") && (n.endsWith(".nsis.zip") || n.endsWith(".zip")),
    );
    if (winFile) {
      winZipName = path.basename(winFile);
      const sigFile = `${winFile}.sig`;
      if (fs.existsSync(sigFile)) {
        winSignature = fs.readFileSync(sigFile, "utf-8");
      }
    }
  }

  const manifest = generateR2UpdaterManifest({
    version,
    distributionUrl,
    appName,
    macTarName,
    macSignature,
    winZipName,
    winSignature,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ Generated R2 updater manifest: ${outputPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  runCli();
}
