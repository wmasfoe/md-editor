/**
 * beta 分支 CI 专用：基于当前基础版本派生唯一的 beta 版本并就地改写四处版本文件。
 *
 * 派生规则：`<基础版本>-beta.<commit短哈希>`（如 0.3.19-beta.abc1234）。
 * - 基础版本取 tauri.conf.json version 的 `-` 之前部分，beta 分支上即使带了
 *   `-beta.x` 后缀也能继续基于主版本派生，避免与手动 tag 的 prerelease 撞名；
 * - commit 短哈希保证同一提交重跑 workflow 时版本稳定（产物可覆盖），
 *   不同提交天然产生不同 release tag，互不冲突。
 *
 * 改写是 checkout 后本地文件操作，不提交回仓库；四处文件保持版本一致，
 * 满足 release-macos.yml 与 build-macos.yml 的版本一致性校验。
 *
 * 输出（写入 GITHUB_OUTPUT）：
 *   base_version / beta_version / beta_tag / short_sha
 */
import fs from "node:fs";
import {
  cargoManifestPath,
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
const baseVersion = tauriConfig.version.split("-")[0];
const betaVersion = `${baseVersion}-beta.${shortSha}`;

updatePackageJson(rootPackagePath, betaVersion);
updatePackageJson(desktopPackagePath, betaVersion);
updateTauriConfig(betaVersion);
updateCargoManifest(betaVersion);

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

console.log(`base_version=${baseVersion}`);
console.log(`beta_version=${betaVersion}`);
console.log(`beta_tag=v${betaVersion}`);
console.log(`short_sha=${shortSha}`);
