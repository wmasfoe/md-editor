import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const releaseDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cache layout of tauri-bundler 2.9.4, which is what `@tauri-apps/cli` 2.11.4
 * bundles. The bundler downloads these only when the cache file is missing,
 * then runs `dd` on the linuxdeploy AppImage (ELF bytes 8–10). A newer CLI
 * that changes LINUXDEPLOY_COMMIT_HASH or the cache filename will skip this
 * wrapper; `validate-appimage.mjs` still rejects a bundled libwayland-client.so.0.
 */
export const TAURI_BUNDLER_LINUXDEPLOY_RELEASE = "linuxdeploy";
export const LINUXDEPLOY_DOWNLOAD_ROOT =
  "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy";
export const GTK_PLUGIN_URL =
  "https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh";
export const WRAPPER_MARKER = "INKPOINT_LINUXDEPLOY_WRAPPER";
export const EXCLUDED_LIBRARY = "libwayland-client.so.0";
export const HOOK_FILENAME = "inkpoint-linuxdeploy-hook.so";
export const WRAPPER_SOURCE = path.join(releaseDir, "linuxdeploy-wrapper.c");
export const HOOK_SOURCE = path.join(releaseDir, "linuxdeploy-exec-hook.c");

export const AMD64_UPDATE_INFORMATION =
  "gh-releases-zsync|wmasfoe|md-editor|latest|Inkpoint_*_amd64.AppImage.zsync";
export const AARCH64_UPDATE_INFORMATION =
  "gh-releases-zsync|wmasfoe|md-editor|latest|Inkpoint_*_aarch64.AppImage.zsync";

const GTK_PLUGIN_ORIGINAL_LINE =
  'env LINUXDEPLOY_PLUGIN_MODE=1 "$LINUXDEPLOY" --appdir="$APPDIR" "${LIBRARIES[@]}"';
const GTK_PLUGIN_PATCHED_LINE = `${GTK_PLUGIN_ORIGINAL_LINE} --exclude-library ${EXCLUDED_LIBRARY}`;

function defaultCacheDir() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, "tauri");
  return path.join(os.homedir(), ".cache", "tauri");
}

function curlDownload(url, destination) {
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", destination, url], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function fileContains(filePath, needle) {
  return fs.readFileSync(filePath).includes(Buffer.from(needle));
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

/**
 * Arch token used in `linuxdeploy-<arch>.AppImage`. Tauri maps the Rust target
 * triple's first component, except `i686` which the upstream asset calls `i386`.
 */
export function linuxdeployArch(nodeArch = process.arch) {
  if (nodeArch === "x64" || nodeArch === "x86_64") return "x86_64";
  if (nodeArch === "arm64" || nodeArch === "aarch64") return "aarch64";
  if (nodeArch === "ia32" || nodeArch === "i686") return "i386";
  if (nodeArch === "arm" || nodeArch === "armhf") return "armhf";
  throw new Error(`No linuxdeploy build for architecture ${nodeArch}.`);
}

export function linuxdeployCacheName(arch = linuxdeployArch()) {
  return `linuxdeploy-${arch}.AppImage`;
}

export function updateInformationForArch(arch = linuxdeployArch()) {
  if (arch === "x86_64") return AMD64_UPDATE_INFORMATION;
  if (arch === "aarch64") return AARCH64_UPDATE_INFORMATION;
  throw new Error(`No AppImage update information for linuxdeploy arch ${arch}.`);
}

export function normalizeUpdateInformation(raw) {
  return String(raw).replaceAll("\0", "").trim();
}

export function expectedUpdateInformation(appImageName) {
  if (appImageName.includes("_aarch64.") || appImageName.includes("_arm64.")) {
    return AARCH64_UPDATE_INFORMATION;
  }
  if (appImageName.includes("_amd64.") || appImageName.includes("_x86_64.")) {
    return AMD64_UPDATE_INFORMATION;
  }
  return null;
}

/**
 * The GTK plugin copies Gdk/GObject/Pango by re-invoking linuxdeploy. That
 * invocation is separate from the outer `--exclude-library` and will bundle
 * libwayland-client.so.0 unless the flag is on this line too.
 */
export function patchGtkPluginScript(source) {
  if (source.includes(GTK_PLUGIN_PATCHED_LINE)) return source;
  if (!source.includes(GTK_PLUGIN_ORIGINAL_LINE)) {
    throw new Error(
      "linuxdeploy-plugin-gtk.sh no longer contains the library deploy invocation this build patches. Refusing to bundle libwayland-client.so.0.",
    );
  }
  return source.replace(
    GTK_PLUGIN_ORIGINAL_LINE,
    `# Inkpoint: libwayland-client.so.0 must come from the host (AppImage excludelist).\n${GTK_PLUGIN_PATCHED_LINE}`,
  );
}

function compileWithGcc(args) {
  try {
    execFileSync("gcc", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : error.message;
    throw new Error(
      `gcc is required to prepare the linuxdeploy exclude wrapper (${stderr.trim()}).`,
      { cause: error },
    );
  }
}

/**
 * Installs the ELF wrapper at the path Tauri executes, keeps the upstream
 * AppImage beside it as `*.real`, and patches the cached GTK plugin script.
 * Safe to run on every build: Tauri will not re-download files that exist.
 */
export function prepareLinuxDeployTools({
  cacheDir = defaultCacheDir(),
  arch = linuxdeployArch(),
  platform = process.platform,
  download = curlDownload,
  compileWrapper = (output) => {
    compileWithGcc(["-O2", "-o", output, WRAPPER_SOURCE]);
  },
  compileHook = (output) => {
    compileWithGcc(["-shared", "-fPIC", "-O2", "-o", output, HOOK_SOURCE, "-ldl"]);
  },
} = {}) {
  if (platform !== "linux") return null;

  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o755 });
  const cacheName = linuxdeployCacheName(arch);
  const cachePath = path.join(cacheDir, cacheName);
  const realPath = `${cachePath}.real`;
  const downloadUrl = `${LINUXDEPLOY_DOWNLOAD_ROOT}/${cacheName}`;

  if (fs.existsSync(cachePath) && !fileContains(cachePath, WRAPPER_MARKER)) {
    fs.renameSync(cachePath, realPath);
  }
  if (!fs.existsSync(realPath) || fs.statSync(realPath).size === 0) {
    download(downloadUrl, realPath);
  }
  fs.chmodSync(realPath, 0o755);

  compileWrapper(cachePath);
  fs.chmodSync(cachePath, 0o755);
  if (!fileContains(cachePath, WRAPPER_MARKER)) {
    throw new Error(`linuxdeploy wrapper ${cachePath} is missing ${WRAPPER_MARKER}.`);
  }

  const hookPath = path.join(cacheDir, HOOK_FILENAME);
  compileHook(hookPath);
  fs.chmodSync(hookPath, 0o755);

  const gtkPluginPath = path.join(cacheDir, "linuxdeploy-plugin-gtk.sh");
  if (!fs.existsSync(gtkPluginPath) || fs.statSync(gtkPluginPath).size === 0) {
    download(GTK_PLUGIN_URL, gtkPluginPath);
  }
  const patched = patchGtkPluginScript(fs.readFileSync(gtkPluginPath, "utf8"));
  fs.writeFileSync(gtkPluginPath, patched);
  fs.chmodSync(gtkPluginPath, 0o755);

  return { cachePath, realPath, hookPath, gtkPluginPath, downloadUrl };
}

/**
 * appimagetool writes a sibling `.zsync` when update info is embedded. This
 * only fills the gap: `zsyncmake` reads the AppImage and must not rewrite it,
 * because a release build's minisign `.sig` already covers those bytes.
 */
export function ensureAppImageZsyncFiles(bundleDir, extraSearchDirs = []) {
  const images = fs.readdirSync(bundleDir).filter((name) => name.endsWith(".AppImage"));
  for (const name of images) {
    const imagePath = path.join(bundleDir, name);
    const zsyncPath = `${imagePath}.zsync`;
    if (fs.existsSync(zsyncPath) && fs.statSync(zsyncPath).size > 0) {
      console.log(`AppImage zsync: ${zsyncPath}`);
      continue;
    }

    for (const dir of extraSearchDirs) {
      const stray = path.join(dir, `${name}.zsync`);
      if (!fs.existsSync(stray) || fs.statSync(stray).size === 0) continue;
      fs.renameSync(stray, zsyncPath);
      break;
    }
    if (fs.existsSync(zsyncPath) && fs.statSync(zsyncPath).size > 0) continue;

    const digestBefore = sha256File(imagePath);
    execFileSync("zsyncmake", ["-o", zsyncPath, imagePath], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    const digestAfter = sha256File(imagePath);
    if (digestBefore !== digestAfter) {
      throw new Error(`zsyncmake modified ${imagePath}; refusing to ship a rewritten AppImage.`);
    }
    console.log(`AppImage zsync: ${zsyncPath}`);
  }
}
