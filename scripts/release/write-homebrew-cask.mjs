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
const encodedFileName = fileName
  .split("/")
  .map((part) => encodeURIComponent(part))
  .join("/");
const encodedReleaseTag = encodeURIComponent(releaseTag);

const cask = `cask "md-editor" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/${releaseRepository}/releases/download/${encodedReleaseTag}/${encodedFileName}"
  name "Markdown Editor"
  desc "Markdown and MDX-compatible desktop editor"
  homepage "https://github.com/wmasfoe/md-editor"

  app "Markdown Editor.app"
end
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, cask);
console.log(`Wrote ${outputPath}`);
