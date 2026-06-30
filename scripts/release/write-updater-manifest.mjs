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

const manifest = {
  version,
  notes: `Markdown Editor ${version}`,
  platforms: {
    [platform]: {
      signature,
      url: downloadUrl
    }
  }
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
