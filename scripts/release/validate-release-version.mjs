/**
 * 校验桌面端发布版本号在三处来源一致。
 *
 * GPUI 桌面取代 Tauri 后，版本真源是 apps/desktop/Cargo.toml 的 [package] version；
 * apps/desktop/package.json（Changesets/发版脚本读取）与根 Cargo.lock 的
 * inkpoint-gpui 条目必须与之同步，否则 DMG 的 CFBundleShortVersionString
 * 会和 release tag 漂移。
 */
import fs from "node:fs";

const cargoManifestPath = "apps/desktop/Cargo.toml";
const desktopPackagePath = "apps/desktop/package.json";
const cargoLockPath = "Cargo.lock";
const crateName = "inkpoint-gpui";

const cargoManifest = fs.readFileSync(cargoManifestPath, "utf8");
const cargoVersion = cargoManifest.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
if (!cargoVersion) {
  throw new Error(`Unable to find [package] version in ${cargoManifestPath}.`);
}

const desktopVersion = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8")).version;

// Cargo.lock 只记录精确版本，从 crate 名定位到它自己的 [[package]] 块再取 version。
const escapedCrateName = crateName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const lockPattern = new RegExp(
  `\\[\\[package\\]\\]\\s*\\nname\\s*=\\s*"${escapedCrateName}"\\s*\\nversion\\s*=\\s*"([^"]+)"`,
  "u",
);
const lockVersion = fs.readFileSync(cargoLockPath, "utf8").match(lockPattern)?.[1];
if (!lockVersion) {
  throw new Error(`Unable to find ${crateName} package version in ${cargoLockPath}.`);
}

const versions = [desktopVersion, cargoVersion, lockVersion];
if (versions.some((version) => version !== cargoVersion)) {
  throw new Error(
    `Version mismatch: desktop=${desktopVersion}, cargo=${cargoVersion}, lock=${lockVersion}`,
  );
}

console.log(`Release version validation passed: v${cargoVersion}`);
