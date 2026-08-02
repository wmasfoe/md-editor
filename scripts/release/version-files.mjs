/**
 * 版本文件读写共享模块：统一更新 package.json / tauri.conf.json / Cargo.toml 的版本字段，
 * 供交互式发布工具（version-desktop.mjs）与 CI 派生脚本（derive-beta-version.mjs）复用。
 */
import fs from "node:fs";

export const rootPackagePath = "package.json";
export const desktopPackagePath = "apps/desktop/package.json";
export const cargoManifestPath = "apps/desktop/src-tauri/Cargo.toml";
export const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function updatePackageJson(path, version) {
  const packageJson = readJson(path);
  packageJson.version = version;
  writeJson(path, packageJson);
}

export function updateTauriConfig(version) {
  const config = readJson(tauriConfigPath);
  config.version = version;
  writeJson(tauriConfigPath, config);
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
