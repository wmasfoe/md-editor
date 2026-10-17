import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function generateR2UpdaterManifest({
  version,
  distributionUrl = "https://download.justdev.cn",
  appName = "inkpoint",
  macTarName = "Inkpoint.app.tar.gz",
  macSignature,
  winUpdaterName,
  winSignature,
  notes,
}) {
  if (!version) {
    throw new Error("Missing version");
  }

  const normalizedVersion = version.replace(/^v/, "");
  const platforms = {};

  if (macSignature) {
    platforms["darwin-aarch64"] = {
      signature: macSignature.trim(),
      url: `${distributionUrl}/${appName}/desktop/${normalizedVersion}/${macTarName}`,
    };
  }

  if (winUpdaterName && winSignature) {
    platforms["windows-x86_64"] = {
      signature: winSignature.trim(),
      url: `${distributionUrl}/${appName}/desktop/${normalizedVersion}/${winUpdaterName}`,
    };
  }

  return {
    version: normalizedVersion,
    notes: notes || `Inkpoint ${normalizedVersion}`,
    platforms,
  };
}

function findFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const res = findFile(fullPath, predicate);
      if (res) return res;
    } else if (predicate(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

/**
 * 在 `artifactsDir` 中解析各平台的更新产物与签名。
 *
 * Windows 的更新产物有两种形态，取决于 Tauri 版本：
 *  1. 旧的 `<...>_x64-setup.nsis.zip`（带 `.sig`）；
 *  2. **当前实际产出的 NSIS 安装器本体 `<...>_x64-setup.exe` + 同名 `.sig`**。
 * 早期实现只匹配 `.zip`，于是 `windows-x86_64` 条目长期缺失——Windows 用户因此收不到
 * 应用内更新（详见 docs/agent/release/release_workflow.md）。
 */
export function resolveUpdaterArtifacts(artifactsDir, env = process.env) {
  const resolved = {
    macTarName: "Inkpoint.app.tar.gz",
    macSignature: env.MAC_UPDATER_SIGNATURE,
    winUpdaterName: undefined,
    winSignature: env.WIN_UPDATER_SIGNATURE,
  };

  if (!artifactsDir || !fs.existsSync(artifactsDir)) {
    return resolved;
  }

  const macFile = findFile(artifactsDir, (n) => n.endsWith(".app.tar.gz"));
  if (macFile) {
    resolved.macTarName = path.basename(macFile);
    if (fs.existsSync(`${macFile}.sig`)) {
      resolved.macSignature = fs.readFileSync(`${macFile}.sig`, "utf-8");
    }
  }

  // `x64` 限定 64 位 Intel/AMD 安装包；`arm64` 不含该子串，不会被误匹配。
  // 按优先级依次尝试：`.nsis.zip`（旧形态） → 其他 `.zip` → **NSIS 安装器本体**（当前实际产出）。
  const winUpdaterMatchers = [
    (name) => name.includes("x64") && name.endsWith(".nsis.zip"),
    (name) => name.includes("x64") && name.endsWith(".zip"),
    (name) => name.includes("x64") && name.endsWith("-setup.exe"),
  ];
  const winFile = winUpdaterMatchers.map((match) => findFile(artifactsDir, match)).find(Boolean);
  if (winFile) {
    resolved.winUpdaterName = path.basename(winFile);
    if (fs.existsSync(`${winFile}.sig`)) {
      resolved.winSignature = fs.readFileSync(`${winFile}.sig`, "utf-8");
    }
  }

  return resolved;
}

export function runCli() {
  const version = process.env.RELEASE_VERSION;
  if (!version) {
    console.error("RELEASE_VERSION is required");
    process.exit(1);
  }

  const artifactsDir = process.env.ARTIFACTS_DIR || "release-artifacts";
  const outputPath = process.env.OUTPUT_PATH || "dist-desktop/updater.json";
  const distributionUrl = process.env.DISTRIBUTION_URL || "https://download.justdev.cn";
  const appName = process.env.APP_NAME || "inkpoint";

  const { macTarName, macSignature, winUpdaterName, winSignature } = resolveUpdaterArtifacts(
    artifactsDir,
    process.env,
  );

  if (!macSignature) {
    console.warn(
      "⚠️ 未找到 macOS 更新签名：darwin-aarch64 条目将缺失（macOS 用户收不到应用内更新）",
    );
  }
  if (!winUpdaterName || !winSignature) {
    console.warn(
      "⚠️ 未找到 Windows 更新产物或签名：windows-x86_64 条目将缺失（Windows 用户收不到应用内更新）",
    );
  }

  const manifest = generateR2UpdaterManifest({
    version,
    distributionUrl,
    appName,
    macTarName,
    macSignature,
    winUpdaterName,
    winSignature,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `✓ Generated R2 updater manifest: ${outputPath} (platforms: ${Object.keys(manifest.platforms).join(", ") || "none"})`,
  );
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isDirectRun) {
  runCli();
}
