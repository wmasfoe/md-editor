import fs from "node:fs";
import path from "node:path";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const version = requiredEnv("RELEASE_VERSION");
const sha256 = requiredEnv("DMG_SHA256");
const fileName = requiredEnv("DMG_FILE_NAME");
const outputPath = process.env.CASK_OUTPUT_PATH?.trim() || "Casks/md-editor.rb";
const releaseRepository = process.env.CASK_RELEASE_REPOSITORY?.trim() || "wmasfoe/md-editor";
const releaseTag = process.env.CASK_RELEASE_TAG?.trim() || `v${version}`;
const downloadUrl = process.env.CASK_DOWNLOAD_URL?.trim();

// GitHub Release asset URLs can contain encoded spaces or normalized file names.
// Prefer the URL returned by the Release API when the workflow provides one.
const encodedFileName = fileName
  .split("/")
  .map((part) => encodeURIComponent(part))
  .join("/");
const encodedReleaseTag = encodeURIComponent(releaseTag);
const assetUrl =
  downloadUrl || `https://github.com/${releaseRepository}/releases/download/${encodedReleaseTag}/${encodedFileName}`;

// Homebrew's sha256 only verifies that the downloaded DMG matches this release.
// It does not make macOS trust the app. Gatekeeper trust still depends on the
// DMG/app being Developer ID signed, notarized, and stapled during the build.
const cask = `cask "md-editor" do
  version "${version}"
  sha256 "${sha256}"

  url "${assetUrl}"
  name "Markdown Editor"
  desc "Markdown and MDX-compatible desktop editor"
  homepage "https://github.com/wmasfoe/md-editor"

  app "Markdown Editor.app"
end
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, cask);
console.log(`Wrote ${outputPath}`);
