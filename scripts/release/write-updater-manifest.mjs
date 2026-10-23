import fs from "node:fs";
import path from "node:path";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validateHttpsUrl(value, envName) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${envName} must be an HTTPS URL.`);
  }
  return parsed.toString();
}

const version = requiredEnv("RELEASE_VERSION");
const downloadUrl = validateHttpsUrl(requiredEnv("UPDATER_DOWNLOAD_URL"), "UPDATER_DOWNLOAD_URL");
const signature = requiredEnv("UPDATER_SIGNATURE");
const platform = process.env.UPDATER_PLATFORM?.trim() || "darwin-aarch64";
const outputPath = process.env.UPDATER_MANIFEST_OUTPUT_PATH?.trim() || "md-editor-latest.json";

if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error(`Expected a SemVer release version, got "${version}".`);
}
if (!/^(linux|darwin|windows)-(x86_64|aarch64|i686|armv7)$/u.test(platform)) {
  throw new Error(`Unsupported updater platform key: ${platform}`);
}

let existingManifest = {};
if (fs.existsSync(outputPath)) {
  try {
    const content = fs.readFileSync(outputPath, "utf-8");
    existingManifest = JSON.parse(content);
  } catch (error) {
    console.warn(`Failed to read existing manifest at ${outputPath}: ${error}`);
  }
}

// Homebrew tap 的 md-editor-latest.json 是 tauri.conf.json 注册的第二 update endpoint：
// R2 不可用或受限流影响时客户端会落到这里，因此同样要带真实更新内容，
// 否则「检测到更新但没有更新内容」会在最需要的时候复现。
const notesFile = process.env.RELEASE_NOTES_FILE?.trim();
const notes = notesFile ? fs.readFileSync(notesFile, "utf-8").trim() : "";
if (!notes) {
  console.warn(
    "⚠️ RELEASE_NOTES_FILE is missing or empty: the Homebrew tap manifest will fall back to a version-only note.",
  );
}

const manifest = {
  version,
  notes: notes || `Inkpoint ${version}`,
  platforms: {
    ...(existingManifest.version === version ? existingManifest.platforms : {}),
    [platform]: {
      signature,
      url: downloadUrl,
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
