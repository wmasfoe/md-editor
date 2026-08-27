/**
 * 版本文件读写共享模块：统一更新 package.json / tauri.conf.json / Cargo.toml 的版本字段，
 * 供交互式发布工具（version-desktop.mjs）与 CI 派生脚本（derive-beta-version.mjs）复用。
 */
import fs from "node:fs";

export const rootPackagePath = "package.json";
export const desktopPackagePath = "apps/desktop/package.json";
export const cargoManifestPath = "apps/desktop/src-tauri/Cargo.toml";
export const cargoLockPath = "apps/desktop/src-tauri/Cargo.lock";
export const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function updatePackageJson(path, version) {
  replaceJsonVersion(path, version);
}

export function updateTauriConfig(version) {
  replaceJsonVersion(tauriConfigPath, version);
}

function replaceJsonVersion(path, version) {
  const contents = fs.readFileSync(path, "utf8");
  const nextContents = contents.replace(/^(\s{2}"version"\s*:\s*)"[^"]*"/mu, `$1"${version}"`);

  if (nextContents === contents) {
    throw new Error(`Unable to find top-level version in ${path}.`);
  }

  fs.writeFileSync(path, nextContents);
}

export function updateCargoManifest(version) {
  const contents = fs.readFileSync(cargoManifestPath, "utf8");
  let inPackageSection = false;
  let updated = false;

  const nextContents = contents
    .split(/(?<=\n)/u)
    .map((line) => {
      const trimmedLine = line.trim();

      if (/^\[[^\]]+\]$/u.test(trimmedLine)) {
        inPackageSection = trimmedLine === "[package]";
      }

      if (!inPackageSection || updated) {
        return line;
      }

      return line.replace(/^(\s*version\s*=\s*)"[^"]*"/u, (_match, prefix) => {
        updated = true;
        return `${prefix}"${version}"`;
      });
    })
    .join("");

  if (!updated) {
    throw new Error(`Unable to find [package] version in ${cargoManifestPath}.`);
  }

  fs.writeFileSync(cargoManifestPath, nextContents);
}

export function updateCargoLock(version) {
  const manifest = fs.readFileSync(cargoManifestPath, "utf8");
  const packageName = manifest.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
  if (!packageName) {
    throw new Error(`Unable to find [package] name in ${cargoManifestPath}.`);
  }

  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const packagePattern = new RegExp(
    `(\\[\\[package\\]\\]\\s*\\nname\\s*=\\s*"${escapedName}"\\s*\\nversion\\s*=\\s*)"[^"]*"`,
    "u",
  );
  const contents = fs.readFileSync(cargoLockPath, "utf8");
  const nextContents = contents.replace(packagePattern, `$1"${version}"`);

  if (nextContents === contents) {
    throw new Error(`Unable to find ${packageName} package version in ${cargoLockPath}.`);
  }

  fs.writeFileSync(cargoLockPath, nextContents);
}
