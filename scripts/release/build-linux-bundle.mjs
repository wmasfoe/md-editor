import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureAppImageZsyncFiles,
  prepareLinuxDeployTools,
  prependLibraryDirectory,
  updateInformationForArch,
} from "./appimage-catalog.mjs";
import { seedAppImageLauncherCache } from "./validate-appimage.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== "linux") {
  fail("build-linux-bundle.mjs builds the Linux AppImage and deb on Linux.");
}

const release = process.argv.includes("--release");
const seeded = seedAppImageLauncherCache();
if (seeded) {
  console.log(`Seeded Tauri AppImage launcher with mode 0755: ${seeded}`);
}

const prepared = prepareLinuxDeployTools();
if (!prepared) fail("Failed to prepare the linuxdeploy wrapper.");
console.log(`Prepared linuxdeploy wrapper: ${prepared.cachePath}`);

// Embedded before appimagetool runs, which is also before minisign. Do not
// repack the AppImage afterwards: that would invalidate the updater signature.
const updateInformation = updateInformationForArch();
const binariesDir = path.join(repoRoot, "apps/desktop/src-tauri/binaries");
// llama-server links libllama.so from this directory. release-desktop.yml sets
// LD_LIBRARY_PATH to it; prepend when the variable already points elsewhere.
const libraryPath = prependLibraryDirectory(process.env.LD_LIBRARY_PATH, binariesDir);
const env = {
  ...process.env,
  NO_STRIP: process.env.NO_STRIP ?? "true",
  APPIMAGE_EXTRACT_AND_RUN: "1",
  LD_LIBRARY_PATH: libraryPath,
  LDAI_UPDATE_INFORMATION: updateInformation,
  UPDATE_INFORMATION: updateInformation,
  LDAI_UPD_INFO: updateInformation,
  UPD_INFO: updateInformation,
  LINUXDEPLOY_EXCLUDED_LIBRARIES: "libwayland-client.so.0",
};

const args = [
  "--filter",
  "@md-editor/desktop",
  "tauri",
  "build",
  "--bundles",
  "appimage,deb",
  "--verbose",
];
if (release) args.push("--config", "src-tauri/tauri.release.conf.json");

const build = spawnSync("pnpm", args, { cwd: repoRoot, env, stdio: "inherit" });
if (build.error) fail(build.error.message);
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);

const bundleDir = path.join(repoRoot, "apps/desktop/src-tauri/target/release/bundle/appimage");
const tauriDir = path.join(repoRoot, "apps/desktop/src-tauri");
ensureAppImageZsyncFiles(bundleDir, [tauriDir, repoRoot]);

const validate = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts/release/validate-appimage.mjs"), bundleDir],
  { cwd: repoRoot, stdio: "inherit" },
);
if (validate.error) fail(validate.error.message);
process.exit(validate.status ?? 1);
