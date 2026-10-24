import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expectedUpdateInformation, normalizeUpdateInformation } from "./appimage-catalog.mjs";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function formatMode(mode) {
  return `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
}

function hasCommand(command) {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // continue searching PATH
    }
  }
  return false;
}

function resolveTauriToolsArch(nodeArch = process.arch) {
  if (nodeArch === "x64") return "x86_64";
  if (nodeArch === "arm64") return "aarch64";
  if (nodeArch === "ia32") return "i686";
  if (nodeArch === "arm") return "armhf";
  return nodeArch;
}

function resolveDefaultTauriCacheDir() {
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "tauri");
  }
  return path.join(os.homedir(), ".cache", "tauri");
}

/**
 * Pre-seeds Tauri's Linux AppImage bundler cache with a world-executable (`0755`)
 * `AppRun-<arch>` binary before `tauri build` runs.
 *
 * Why this exists:
 * `tauri-bundler`'s `write_and_make_executable` writes downloaded tools with mode `0770`
 * (`-rwxrwx---`). When copied into `AppDir/AppRun` and wrapped by `linuxdeploy` into
 * `AppRun.wrapped`, the `0770` mode prevents any non-owner user (such as `firejail --appimage`
 * or AppImageHub's catalog test) from starting the AppImage (`Permission denied`, tauri#16155).
 * Because `tauri-bundler` only downloads `AppRun-<arch>` when missing from its cache, placing
 * a `0755` copy in the cache beforehand guarantees `AppRun` and `AppRun.wrapped` are `0755`.
 */
export function seedAppImageLauncherCache({
  cacheDir = resolveDefaultTauriCacheDir(),
  arch = resolveTauriToolsArch(),
  platform = process.platform,
  download = (url, destination) => {
    execFileSync("curl", ["-fsSL", "--retry", "3", "-o", destination, url], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  },
} = {}) {
  if (platform !== "linux") {
    return null;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  const launcherName = `AppRun-${arch}`;
  const launcherPath = path.join(cacheDir, launcherName);
  const url = `https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/${launcherName}`;

  if (!fs.existsSync(launcherPath) || fs.statSync(launcherPath).size === 0) {
    download(url, launcherPath);
  }

  fs.chmodSync(launcherPath, 0o755);
  const mode = fs.statSync(launcherPath).mode & 0o777;
  if ((mode & 0o555) !== 0o555) {
    throw new Error(
      `Failed to set 0755 permissions on cached AppImage launcher ${launcherPath} (got ${formatMode(mode)}).`,
    );
  }

  return launcherPath;
}

function assertRelativeSymlinkInsideAppDir(root, entryPath, label) {
  const lstat = fs.lstatSync(entryPath);
  if (lstat.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(entryPath);
    if (path.isAbsolute(linkTarget)) {
      throw new Error(`AppImage ${label} must use a relative symlink (got ${linkTarget}).`);
    }
  }

  const resolved = fs.realpathSync(entryPath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`AppImage ${label} must resolve to a file inside the AppDir.`);
  }
  return resolved;
}

function validatePngFile(filePath, label) {
  if (!fs.statSync(filePath).isFile()) {
    throw new Error(`AppImage ${label} must resolve to a PNG file.`);
  }

  const header = Buffer.alloc(24);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      header.toString("ascii", 12, 16) !== "IHDR" ||
      header.readUInt32BE(16) === 0 ||
      header.readUInt32BE(20) === 0
    ) {
      throw new Error(`AppImage ${label} must resolve to a PNG file with valid dimensions.`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseDesktopEntrySection(content) {
  const keys = new Map();
  let inDesktopEntry = false;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inDesktopEntry = line === "[Desktop Entry]";
      continue;
    }
    if (!inDesktopEntry) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    keys.set(key, (keys.get(key) ?? []).concat(value));
  }
  return keys;
}

function validateDesktopEntry(root, desktopPath) {
  const label = path.basename(desktopPath);
  const resolvedDesktop = assertRelativeSymlinkInsideAppDir(root, desktopPath, label);
  if (!fs.statSync(resolvedDesktop).isFile()) {
    throw new Error(`AppImage ${label} must resolve to a regular file.`);
  }

  const content = fs.readFileSync(resolvedDesktop, "utf8");
  const keys = parseDesktopEntrySection(content);
  for (const requiredKey of ["Name", "Exec", "Icon", "Categories"]) {
    const values = keys.get(requiredKey) ?? [];
    if (values.length !== 1 || !values[0]) {
      throw new Error(
        `AppImage ${label} must define ${requiredKey}= exactly once in [Desktop Entry].`,
      );
    }
  }

  const iconName = keys.get("Icon")[0];
  const topLevelPng = path.join(root, `${iconName}.png`);
  const topLevelSvg = path.join(root, `${iconName}.svg`);
  if (fs.existsSync(topLevelPng)) {
    const resolvedIcon = assertRelativeSymlinkInsideAppDir(root, topLevelPng, `${iconName}.png`);
    validatePngFile(resolvedIcon, `${iconName}.png`);
  } else if (fs.existsSync(topLevelSvg)) {
    assertRelativeSymlinkInsideAppDir(root, topLevelSvg, `${iconName}.svg`);
  } else {
    throw new Error(
      `AppImage must contain a top-level icon (${iconName}.png or ${iconName}.svg) matching Icon=${iconName} in ${label}.`,
    );
  }
}

function validatePermissionsTree(root, { checkDirectories = false } = {}) {
  const stack = [root];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, fullPath);
      const lstat = fs.lstatSync(fullPath);

      if (lstat.isSymbolicLink()) {
        assertRelativeSymlinkInsideAppDir(root, fullPath, relativePath);
        continue;
      }

      const mode = lstat.mode & 0o777;
      if (lstat.isDirectory()) {
        if (checkDirectories && (mode & 0o005) !== 0o005) {
          throw new Error(
            `AppImage directory ${relativePath} has mode ${formatMode(mode)}; directories must be world-readable and traversable (o+rx).`,
          );
        }
        stack.push(fullPath);
      } else if (lstat.isFile()) {
        if ((mode & 0o004) === 0) {
          throw new Error(
            `AppImage file ${relativePath} has mode ${formatMode(mode)}; all files must be world-readable (o+r).`,
          );
        }
        if ((mode & 0o100) !== 0 && (mode & 0o005) !== 0o005) {
          throw new Error(
            `AppImage executable ${relativePath} has mode ${formatMode(mode)}; executables must be world-readable and world-executable (o+rx, e.g. 0755) so firejail and other users can run them.`,
          );
        }
      }
    }
  }
}

const BLACKLISTED_BASENAMES = new Set(["libwayland-client.so.0"]);

function assertNoBlacklistedFiles(root) {
  const stack = [root];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (BLACKLISTED_BASENAMES.has(entry.name)) {
        throw new Error(
          `AppImage bundles blacklisted file ${path.relative(root, fullPath)}; libwayland-client.so.0 must come from the host.`,
        );
      }
    }
  }
}

function hasCatalogAppdata(root) {
  for (const relativeDir of ["usr/share/metainfo", "usr/share/appdata"]) {
    const dir = path.join(root, relativeDir);
    if (!fs.existsSync(dir)) continue;
    if (fs.readdirSync(dir).some((name) => name.endsWith("appdata.xml"))) return true;
  }
  return false;
}

function assertCatalogAppdata(root) {
  if (hasCatalogAppdata(root)) return;
  throw new Error(
    "AppImage is missing usr/share/metainfo/*appdata.xml (AppImageHub ignores *.metainfo.xml).",
  );
}

export function validateAppDir(
  appDir,
  { requireCompleteAppDir = false, checkDirectories = false } = {},
) {
  const root = fs.realpathSync(appDir);
  assertNoBlacklistedFiles(root);
  if (requireCompleteAppDir) assertCatalogAppdata(root);
  const icon = path.join(root, ".DirIcon");

  // An absolute link can work on the build runner while breaking everywhere else.
  const resolvedIcon = assertRelativeSymlinkInsideAppDir(root, icon, ".DirIcon");
  validatePngFile(resolvedIcon, ".DirIcon");

  const desktopFiles = fs.readdirSync(root).filter((name) => name.endsWith(".desktop"));
  if (requireCompleteAppDir && desktopFiles.length !== 1) {
    throw new Error(
      `AppImage must contain exactly one top-level .desktop file (found ${desktopFiles.length}).`,
    );
  }
  for (const desktopName of desktopFiles) {
    validateDesktopEntry(root, path.join(root, desktopName));
  }

  for (const launcherName of ["AppRun", "AppRun.wrapped"]) {
    const launcherPath = path.join(root, launcherName);
    const exists = fs.existsSync(launcherPath);
    if (!exists) {
      if (requireCompleteAppDir && launcherName === "AppRun") {
        throw new Error("AppImage AppRun is missing in AppDir.");
      }
      continue;
    }
    const resolvedLauncher = assertRelativeSymlinkInsideAppDir(root, launcherPath, launcherName);
    const mode = fs.statSync(resolvedLauncher).mode & 0o777;
    if ((mode & 0o111) !== 0o111 || (mode & 0o444) !== 0o444) {
      throw new Error(
        `AppImage ${launcherName} has mode ${formatMode(mode)}; it must be readable and executable by everyone (0755).`,
      );
    }
  }

  if (process.platform !== "win32") {
    validatePermissionsTree(root, { checkDirectories });
  }
}

function matchesHostLinuxArch(appImageName) {
  if (process.platform !== "linux") return false;
  if (process.arch === "x64") {
    return appImageName.includes("_amd64.") || appImageName.includes("_x86_64.");
  }
  if (process.arch === "arm64") {
    return appImageName.includes("_aarch64.") || appImageName.includes("_arm64.");
  }
  return false;
}

function readAppImageOffset(imagePath) {
  try {
    const rawOffset = execFileSync(imagePath, ["--appimage-offset"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d+$/u.test(rawOffset) && Number(rawOffset) > 0) {
      return rawOffset;
    }
  } catch {
    // Synthetic test runtimes may only implement --appimage-extract
  }
  return null;
}

function hasPasswordlessSudo() {
  if (process.platform !== "linux" || !hasCommand("sudo")) {
    return false;
  }
  try {
    execFileSync("sudo", ["-n", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function runHeadlessWindowSmokeTest(appDir, appImageName, temporaryDirectory) {
  if (!hasCommand("Xvfb") || !hasCommand("xwininfo")) {
    throw new Error(
      `Cannot run --verify-launch for ${appImageName}: Xvfb and xwininfo are required.`,
    );
  }

  const homeDir = path.join(temporaryDirectory, "home");
  const icewmDir = path.join(homeDir, ".icewm");
  fs.mkdirSync(icewmDir, { recursive: true, mode: 0o755 });
  // Match AppImage/appimage.github.io (.github/workflows/test.yml) so IceWM does not
  // create its own visible taskbar window on the virtual display.
  fs.writeFileSync(
    path.join(icewmDir, "preferences"),
    "TaskBarAtTop = 0\nTaskBarKeepBelow = 1\nTaskBarAutoHide = 1\nShowTaskBar = 0\n",
    { mode: 0o644 },
  );

  const display = `:98`;
  const xvfb = spawn("Xvfb", [display, "-screen", "0", "800x600x24"], {
    stdio: "ignore",
  });
  xvfb.unref();

  let wmProcess = null;
  let appProcess = null;
  let appOutput = "";
  let lastTreeOutput = "";
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const x11Env = {
      ...process.env,
      DISPLAY: display,
      HOME: homeDir,
    };

    if (hasCommand("icewm")) {
      wmProcess = spawn("icewm", [], {
        env: x11Env,
        stdio: "ignore",
      });
      wmProcess.unref();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const env = {
      ...x11Env,
      GDK_BACKEND: "x11",
      NO_AT_BRIDGE: "1",
      WEBKIT_DISABLE_DMABUF_RENDERER: "1",
      WEBKIT_DISABLE_COMPOSITING_MODE: "1",
      QTWEBENGINE_DISABLE_SANDBOX: "1",
    };
    delete env.WAYLAND_DISPLAY;
    delete env.LD_LIBRARY_PATH;
    delete env.APPIMAGE_EXTRACT_AND_RUN;

    appProcess = spawn(path.join(appDir, "AppRun"), [], {
      cwd: appDir,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    appProcess.stdout.on("data", (chunk) => {
      appOutput += chunk.toString("utf8");
    });
    appProcess.stderr.on("data", (chunk) => {
      appOutput += chunk.toString("utf8");
    });

    const deadline = Date.now() + 30_000;
    let viewableWindowLine = null;
    while (Date.now() < deadline) {
      if (appProcess.exitCode !== null) {
        throw new Error(
          `AppRun exited prematurely with code ${appProcess.exitCode} before showing a window.\n${appOutput.slice(-2000)}`,
        );
      }

      try {
        const tree = execFileSync("xwininfo", ["-root", "-tree"], {
          env: x11Env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        lastTreeOutput = tree;
        const candidates = tree
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(
            (line) =>
              line.startsWith("0x") &&
              !/\bicewm\b/iu.test(line) &&
              !/\s(?:1x1|10x10)\+/u.test(line) &&
              (/": \("/u.test(line) || /"Inkpoint"|md-editor/iu.test(line)),
          );
        for (const candidate of candidates) {
          const windowId = candidate.split(/\s+/u)[0];
          try {
            const info = execFileSync("xwininfo", ["-id", windowId], {
              env: x11Env,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
            });
            if (info.includes("IsViewable")) {
              viewableWindowLine = candidate;
              break;
            }
          } catch {
            // Candidate window may have been unmapped/destroyed between queries
          }
        }
      } catch {
        // X server or window tree not ready yet
      }

      if (!viewableWindowLine && hasCommand("xdotool")) {
        try {
          const visibleIds = execFileSync("xdotool", ["search", "--onlyvisible", "--name", "."], {
            env: x11Env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          })
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter(Boolean);
          for (const wid of visibleIds) {
            try {
              const info = execFileSync("xwininfo", ["-id", wid], {
                env: x11Env,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
              });
              if (info.includes("IsViewable") && !/\bicewm\b/iu.test(info)) {
                const headerLine = info
                  .split(/\r?\n/u)
                  .find((line) => line.includes("xwininfo: Window id:"));
                viewableWindowLine = headerLine ? headerLine.trim() : wid;
                break;
              }
            } catch {
              // Ignore transient window IDs
            }
          }
        } catch {
          // No visible windows found via xdotool yet
        }
      }

      if (viewableWindowLine) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!viewableWindowLine) {
      throw new Error(
        `AppRun did not map a viewable X11 window within 30s.\n--- App output ---\n${appOutput.slice(-2000)}\n--- X11 root tree ---\n${lastTreeOutput.slice(-2000)}`,
      );
    }

    // Confirm the process remains alive for 3s after mapping its window (matching AppImageHub worker.sh)
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (appProcess.exitCode !== null) {
      throw new Error(
        `AppRun exited with code ${appProcess.exitCode} shortly after mapping its window.\n${appOutput.slice(-2000)}`,
      );
    }

    console.log(`Verified X11 window for ${appImageName}: ${viewableWindowLine}`);
  } finally {
    if (appProcess) {
      appProcess.stdout?.destroy();
      appProcess.stderr?.destroy();
      if (appProcess.pid) {
        try {
          process.kill(-appProcess.pid, "SIGKILL");
        } catch {
          try {
            appProcess.kill("SIGKILL");
          } catch {
            // Process already exited
          }
        }
      }
    }
    if (wmProcess) {
      try {
        wmProcess.kill("SIGKILL");
      } catch {
        // IceWM already exited
      }
    }
    try {
      xvfb.kill("SIGKILL");
    } catch {
      // Xvfb already exited
    }
  }
}

function validateEmbeddedUpdateInformation(imagePath, appImageName) {
  // Synthetic fixtures only implement --appimage-extract. A real runtime that
  // reports --appimage-offset also reports --appimage-updateinformation.
  if (readAppImageOffset(imagePath) === null) return;
  const expected = expectedUpdateInformation(appImageName);
  if (!expected) return;
  let raw = "";
  try {
    raw = execFileSync(imagePath, ["--appimage-updateinformation"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(`AppImage does not report update information (${error.message}).`, {
      cause: error,
    });
  }
  const actual = normalizeUpdateInformation(raw);
  if (actual !== expected) {
    throw new Error(
      `AppImage update information must be ${expected} (got ${JSON.stringify(actual)}).`,
    );
  }
}

function validateInkpointAppstream(extractedRoot) {
  if (!hasCommand("appstreamcli")) return;
  const metainfoDir = path.join(extractedRoot, "usr", "share", "metainfo");
  if (!fs.existsSync(metainfoDir)) return;
  const isInkpoint = fs.readdirSync(metainfoDir).some((name) => {
    const content = fs.readFileSync(path.join(metainfoDir, name), "utf8");
    return content.includes("dev.md_editor.app");
  });
  if (!isInkpoint) return;
  try {
    execFileSync("appstreamcli", ["validate-tree", "--no-net", extractedRoot], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new Error(`appstreamcli validate-tree failed${detail ? `: ${detail}` : "."}`, {
      cause: error,
    });
  }
}

export function validateAppImages(
  directory,
  { requireCompleteAppDir = false, verifyLaunch = false } = {},
) {
  const images = fs.readdirSync(directory).filter((name) => name.endsWith(".AppImage"));
  if (images.length === 0) {
    throw new Error(`No AppImages found in ${directory}.`);
  }

  for (const name of images) {
    const imagePath = path.resolve(directory, name);
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-appimage-check-"));
    try {
      // Extract the final artifact, not the build tree; this never launches AppRun
      // and leaves updater-signed bytes unchanged. Extraction does not require FUSE.
      execFileSync(imagePath, ["--appimage-extract"], {
        cwd: temporaryDirectory,
        stdio: ["ignore", "ignore", "pipe"],
      });
      const extractedRoot = path.join(temporaryDirectory, "squashfs-root");
      validateAppDir(extractedRoot, { requireCompleteAppDir });
      validateEmbeddedUpdateInformation(imagePath, name);
      validateInkpointAppstream(extractedRoot);

      // On Linux, if unsquashfs is installed and the artifact supports --appimage-offset,
      // also verify the stored SquashFS directory permissions (since --appimage-extract
      // creates directories with 0700 regardless of stored SquashFS modes).
      if (process.platform === "linux" && hasCommand("unsquashfs")) {
        const offset = readAppImageOffset(imagePath);
        if (offset !== null) {
          const storeDir = path.join(temporaryDirectory, "squashfs-store");
          const previousUmask = process.umask(0o022);
          try {
            execFileSync("unsquashfs", ["-o", offset, "-d", storeDir, imagePath], {
              stdio: ["ignore", "ignore", "pipe"],
            });
          } finally {
            process.umask(previousUmask);
          }
          validateAppDir(storeDir, { requireCompleteAppDir, checkDirectories: true });
        }
      }

      if (process.platform === "linux" && hasCommand("desktop-file-validate")) {
        const desktopFiles = fs
          .readdirSync(extractedRoot)
          .filter((entry) => entry.endsWith(".desktop"));
        for (const desktopFile of desktopFiles) {
          execFileSync("desktop-file-validate", [path.join(extractedRoot, desktopFile)], {
            stdio: ["ignore", "pipe", "pipe"],
          });
        }
      }

      console.log(`Validated AppImage structure and permissions: ${name}`);
    } catch (error) {
      throw new Error(`Invalid AppImage ${name}: ${error.message}`, { cause: error });
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  if (verifyLaunch) {
    throw new Error(
      "Use validateAppImagesAsync(directory, { verifyLaunch: true }) when verifyLaunch is enabled.",
    );
  }
}

export async function validateAppImagesAsync(
  directory,
  { requireCompleteAppDir = false, verifyLaunch = false } = {},
) {
  validateAppImages(directory, { requireCompleteAppDir, verifyLaunch: false });
  if (!verifyLaunch) return;

  const images = fs.readdirSync(directory).filter((name) => name.endsWith(".AppImage"));
  for (const name of images) {
    if (!matchesHostLinuxArch(name)) continue;
    const imagePath = path.resolve(directory, name);
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-appimage-launch-"));
    fs.chmodSync(temporaryDirectory, 0o755);
    let unpackedAsRoot = false;
    try {
      const launchAppDir = path.join(temporaryDirectory, "squashfs-root");
      const offset = hasCommand("unsquashfs") ? readAppImageOffset(imagePath) : null;
      if (offset !== null && hasPasswordlessSudo()) {
        // Unpack as root so the payload is owned by root:root, testing real non-owner
        // execution permissions (matching firejail's FUSE mount in AppImageHub).
        execFileSync("sudo", ["-n", "unsquashfs", "-o", offset, "-d", launchAppDir, imagePath], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        unpackedAsRoot = true;
      } else if (offset !== null) {
        const previousUmask = process.umask(0o022);
        try {
          execFileSync("unsquashfs", ["-o", offset, "-d", launchAppDir, imagePath], {
            stdio: ["ignore", "ignore", "pipe"],
          });
        } finally {
          process.umask(previousUmask);
        }
      } else {
        execFileSync(imagePath, ["--appimage-extract"], {
          cwd: temporaryDirectory,
          stdio: ["ignore", "ignore", "pipe"],
        });
      }
      await runHeadlessWindowSmokeTest(launchAppDir, name, temporaryDirectory);
    } catch (error) {
      throw new Error(`Invalid AppImage ${name}: ${error.message}`, { cause: error });
    } finally {
      if (unpackedAsRoot) {
        try {
          execFileSync("sudo", ["-n", "rm", "-rf", temporaryDirectory], { stdio: "ignore" });
        } catch {
          // Best-effort cleanup of root-owned files
        }
      }
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function runCli(argv) {
  const args = argv.slice(2);
  if (args.includes("--seed-cache")) {
    const seeded = seedAppImageLauncherCache();
    if (seeded) {
      console.log(`Seeded Tauri AppImage launcher with mode 0755: ${seeded}`);
    }
    return;
  }

  const verifyLaunch =
    args.includes("--verify-launch") ||
    (process.env.CI === "true" &&
      process.platform === "linux" &&
      hasCommand("Xvfb") &&
      hasCommand("xwininfo"));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 1) {
    throw new Error(
      "Usage: node scripts/release/validate-appimage.mjs [--seed-cache] [--verify-launch] <bundle-directory>",
    );
  }

  await validateAppImagesAsync(positional[0], {
    requireCompleteAppDir: true,
    verifyLaunch,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli(process.argv).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
