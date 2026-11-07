import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 应用内更新 manifest 的唯一生成器（Tauri updater 静态 JSON 格式）。
 *
 * 客户端注册了两个 endpoint：R2（`download.jiaqi.im/inkpoint/desktop/updater.json`）与
 * Homebrew tap（`md-editor-latest.json`）。两份清单都由这里生成，平台条目永远一致；
 * 区别只在下载地址的前缀（R2 版本目录 vs tap 的 GitHub Release）。
 *
 * 平台键遵循 tauri-plugin-updater 的查找顺序：先 `{os}-{arch}-{installer}`，再 `{os}-{arch}`。
 * Linux 必须同时写 AppImage 与 deb 的带安装器后缀的键：
 * deb 安装的应用若只能匹配到裸 `linux-x86_64`（AppImage），会拿 AppImage 字节去 `dpkg -i`，安装失败。
 */

/**
 * 每个平台条目的产物匹配规则。`match` 只看文件名；同一平台按顺序取第一个命中的产物。
 * 新增平台只需在这里加一行，CI 与测试自动覆盖。
 */
export const UPDATER_PLATFORMS = [
  // macOS：`.app.tar.gz`。Apple Silicon 的产物历史上没有架构后缀，按「非 x64」识别。
  {
    keys: ["darwin-aarch64", "darwin-aarch64-app"],
    matchers: [(n) => n.endsWith(".app.tar.gz") && !isX64Name(n)],
  },
  {
    keys: ["darwin-x86_64", "darwin-x86_64-app"],
    matchers: [(n) => n.endsWith(".app.tar.gz") && isX64Name(n)],
  },
  // Windows：Tauri v2 的 NSIS 更新产物就是安装器本体；`.nsis.zip` 是旧形态，仍优先识别。
  {
    keys: ["windows-x86_64", "windows-x86_64-nsis"],
    matchers: [
      (n) => n.includes("x64") && n.endsWith(".nsis.zip"),
      (n) => n.includes("x64") && n.endsWith(".zip"),
      (n) => n.includes("x64") && n.endsWith("-setup.exe"),
    ],
  },
  // Linux AppImage：裸键也指向 AppImage（无法识别安装类型时的默认）。
  {
    keys: ["linux-x86_64", "linux-x86_64-appimage"],
    matchers: [(n) => n.endsWith("_amd64.AppImage")],
  },
  {
    keys: ["linux-aarch64", "linux-aarch64-appimage"],
    matchers: [(n) => n.endsWith("_aarch64.AppImage")],
  },
  { keys: ["linux-x86_64-deb"], matchers: [(n) => n.endsWith("_amd64.deb")] },
  { keys: ["linux-aarch64-deb"], matchers: [(n) => n.endsWith("_arm64.deb")] },
];

function isX64Name(name) {
  return /(?:x64|x86_64|intel)/iu.test(name);
}

function listFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

/**
 * 在 `artifactsDir` 中解析每个平台的更新产物与签名。
 * 只有同时存在产物与同名 `.sig` 的平台才会进入清单：没有签名的条目会让客户端校验失败。
 *
 * @returns {Array<{ keys: string[], file: string, name: string, signature: string }>}
 */
export function resolveUpdaterArtifacts(artifactsDir) {
  const files = listFiles(artifactsDir);
  const resolved = [];
  for (const platform of UPDATER_PLATFORMS) {
    const file = platform.matchers
      .map((match) => files.find((candidate) => match(path.basename(candidate))))
      .find(Boolean);
    if (!file || !fs.existsSync(`${file}.sig`)) continue;
    resolved.push({
      keys: platform.keys,
      file,
      name: path.basename(file),
      signature: fs.readFileSync(`${file}.sig`, "utf8").trim(),
    });
  }
  return resolved;
}

/**
 * 生成 manifest。
 *
 * @param {object} options
 * @param {string} options.version 发布版本（允许 `v` 前缀）
 * @param {string} [options.notes] 更新内容（CHANGELOG 版本区块）
 * @param {ReturnType<typeof resolveUpdaterArtifacts>} options.artifacts
 * @param {(name: string, version: string) => string} options.urlFor 产物文件名 → 下载地址
 */
export function generateUpdaterManifest({ version, notes, artifacts, urlFor }) {
  if (!version) {
    throw new Error("Missing version");
  }

  const normalizedVersion = version.replace(/^v/u, "");
  const platforms = {};
  for (const artifact of artifacts) {
    const entry = { signature: artifact.signature, url: urlFor(artifact.name, normalizedVersion) };
    for (const key of artifact.keys) {
      platforms[key] = entry;
    }
  }

  return {
    version: normalizedVersion,
    notes: notes || `Inkpoint ${normalizedVersion}`,
    platforms,
  };
}

/** R2 版本目录下的下载地址。 */
export function r2UrlFor(distributionUrl, appName) {
  return (name, version) => `${distributionUrl}/${appName}/desktop/${version}/${name}`;
}

/** Homebrew tap GitHub Release 的下载地址（R2 不可用时的备用 endpoint）。 */
export function tapUrlFor(repository, tag) {
  return (name) =>
    `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

function readNotes() {
  // 更新内容由 scripts/release/changelog-section.mjs 从 CHANGELOG 抽取后写入文件；
  // 缺省时 manifest 只能退化为 `Inkpoint <version>` 占位，客户端将无法展示本次更新内容。
  const notesFile = process.env.RELEASE_NOTES_FILE?.trim();
  const notes = notesFile
    ? fs.readFileSync(notesFile, "utf8").trim()
    : process.env.RELEASE_NOTES?.trim();
  if (!notes) {
    console.warn(
      "⚠️ 未提供 RELEASE_NOTES_FILE / RELEASE_NOTES：manifest notes 将退化为版本号占位（CI 发版必须提供）",
    );
  }
  return notes;
}

/**
 * CLI：
 * - 默认写 R2 清单（`OUTPUT_PATH`，默认 `dist-desktop/updater.json`）；
 * - 设置 `TAP_REPOSITORY` + `TAP_RELEASE_TAG` + `TAP_OUTPUT_PATH` 时额外写 tap 清单。
 */
export function runCli() {
  const version = process.env.RELEASE_VERSION;
  if (!version) {
    console.error("RELEASE_VERSION is required");
    process.exit(1);
  }

  const artifactsDir = process.env.ARTIFACTS_DIR || "release-artifacts";
  const outputPath = process.env.OUTPUT_PATH || "dist-desktop/updater.json";
  // 与 Tauri updater 首选 endpoint 保持同域：清单与二进制同域，避免客户端跨域下载
  // 命中代理分流慢路径（如 `.cn → DIRECT`）。CI 如需覆盖可显式设置 DISTRIBUTION_URL。
  const distributionUrl = process.env.DISTRIBUTION_URL || "https://download.jiaqi.im";
  const appName = process.env.APP_NAME || "inkpoint";
  const notes = readNotes();
  const artifacts = resolveUpdaterArtifacts(artifactsDir);

  const resolvedKeys = new Set(artifacts.flatMap((artifact) => artifact.keys));
  for (const platform of UPDATER_PLATFORMS) {
    if (!resolvedKeys.has(platform.keys[0])) {
      console.warn(`⚠️ 未找到 ${platform.keys[0]} 的更新产物或签名：该平台用户收不到应用内更新`);
    }
  }

  const outputs = [{ path: outputPath, urlFor: r2UrlFor(distributionUrl, appName) }];
  const tapRepository = process.env.TAP_REPOSITORY?.trim();
  const tapTag = process.env.TAP_RELEASE_TAG?.trim();
  const tapOutputPath = process.env.TAP_OUTPUT_PATH?.trim();
  if (tapRepository && tapTag && tapOutputPath) {
    outputs.push({ path: tapOutputPath, urlFor: tapUrlFor(tapRepository, tapTag) });
  }

  for (const output of outputs) {
    const manifest = generateUpdaterManifest({ version, notes, artifacts, urlFor: output.urlFor });
    fs.mkdirSync(path.dirname(output.path), { recursive: true });
    fs.writeFileSync(output.path, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `✓ Generated updater manifest: ${output.path} (platforms: ${Object.keys(manifest.platforms).join(", ") || "none"})`,
    );
  }
}

const isDirectRun =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));

if (isDirectRun) {
  runCli();
}
