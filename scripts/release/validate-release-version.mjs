import fs from "node:fs";

const desktopPackage = JSON.parse(fs.readFileSync("apps/desktop/package.json", "utf8"));
const tauriConfig = JSON.parse(fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
const cargoToml = fs.readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const versions = [desktopPackage.version, tauriConfig.version, cargoVersion];

if (versions.some((version) => version !== tauriConfig.version)) {
  throw new Error(
    `Version mismatch: desktop=${desktopPackage.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion}`,
  );
}

console.log(`Release version validation passed: v${tauriConfig.version}`);
