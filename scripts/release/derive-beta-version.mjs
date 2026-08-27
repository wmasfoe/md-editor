/**
 * beta 分支 CI 专用：基于当前稳定版本的下一个 patch 版本派生唯一的 beta 版本，
 * 并就地改写四处版本文件。
 *
 * 派生规则：`<下一个 patch 版本>-beta.sha<commit短哈希>`（如 0.3.20-beta.shaabc1234）。
 * - 当前版本 `0.3.19` 或 `0.3.19-beta.x` 都会派生到 `0.3.20`，避免把已发布版本
 *   `0.3.19` 同时标记为 beta；
 * - commit 短哈希保证同一提交重跑 workflow 时版本稳定（产物可覆盖），
 *   不同提交天然产生不同 release tag，互不冲突。
 *
 * 改写是 checkout 后本地文件操作，不提交回仓库；版本文件与 Cargo.lock 保持一致，
 * 满足 release-desktop.yml 与 build-desktop.yml 的版本一致性校验。
 *
 * 输出（写入 GITHUB_OUTPUT）：
 *   source_version / base_version / beta_version / beta_tag / short_sha
 */
import fs from "node:fs";
import {
  cargoManifestPath,
  updateCargoLock,
  desktopPackagePath,
  rootPackagePath,
  readJson,
  tauriConfigPath,
  updateCargoManifest,
  updatePackageJson,
  updateTauriConfig,
} from "./version-files.mjs";

const shortSha = process.env.GITHUB_SHA?.slice(0, 7);
if (!shortSha) {
  throw new Error("derive-beta-version requires GITHUB_SHA to build a unique beta version.");
}

const tauriConfig = readJson(tauriConfigPath);
const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(tauriConfig.version);
if (!versionMatch) {
  throw new Error(`Expected a semver version, got "${tauriConfig.version}".`);
}

const sourceVersion = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
const baseVersion = `${versionMatch[1]}.${versionMatch[2]}.${Number.parseInt(versionMatch[3], 10) + 1}`;
// `sha` 前缀避免短哈希以数字开头时被 Cargo 当成带前导零的数字标识，
// 例如 `beta.0123456` 不是合法的 Cargo SemVer prerelease。
const betaVersion = `${baseVersion}-beta.sha${shortSha}`;

updatePackageJson(rootPackagePath, betaVersion);
updatePackageJson(desktopPackagePath, betaVersion);
updateTauriConfig(betaVersion);
updateCargoManifest(betaVersion);
updateCargoLock(betaVersion);

// 写回后校验四处一致，防止部分更新导致 Tauri 打包失败。
const cargoVersion = fs
  .readFileSync(cargoManifestPath, "utf8")
  .match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const versions = [
  readJson(rootPackagePath).version,
  readJson(desktopPackagePath).version,
  readJson(tauriConfigPath).version,
  cargoVersion,
];
if (versions.some((version) => version !== betaVersion)) {
  throw new Error(`Version mismatch after derive: ${versions.join(", ")}`);
}

console.log(`source_version=${sourceVersion}`);
console.log(`base_version=${baseVersion}`);
console.log(`beta_version=${betaVersion}`);
console.log(`beta_tag=v${betaVersion}`);
console.log(`short_sha=${shortSha}`);
