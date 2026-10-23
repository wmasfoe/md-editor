import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validateAppDir(appDir) {
  const root = fs.realpathSync(appDir);
  const icon = path.join(root, ".DirIcon");

  // An absolute link can work on the build runner while breaking everywhere else.
  if (fs.lstatSync(icon).isSymbolicLink() && path.isAbsolute(fs.readlinkSync(icon))) {
    throw new Error("AppImage .DirIcon must use a relative symlink.");
  }

  const resolvedIcon = fs.realpathSync(icon);
  const relativeIcon = path.relative(root, resolvedIcon);
  if (relativeIcon === ".." || relativeIcon.startsWith(`..${path.sep}`)) {
    throw new Error("AppImage .DirIcon must resolve to a file inside the AppDir.");
  }
  if (!fs.statSync(resolvedIcon).isFile()) {
    throw new Error("AppImage .DirIcon must resolve to a PNG file.");
  }

  const header = Buffer.alloc(24);
  const descriptor = fs.openSync(resolvedIcon, "r");
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      header.toString("ascii", 12, 16) !== "IHDR" ||
      header.readUInt32BE(16) === 0 ||
      header.readUInt32BE(20) === 0
    ) {
      throw new Error("AppImage .DirIcon must resolve to a PNG file with valid dimensions.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validateAppImages(directory) {
  const images = fs.readdirSync(directory).filter((name) => name.endsWith(".AppImage"));
  if (images.length === 0) {
    throw new Error(`No AppImages found in ${directory}.`);
  }

  for (const name of images) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-appimage-check-"));
    try {
      // Extract the final artifact, not the build tree; this never launches AppRun
      // and leaves updater-signed bytes unchanged. Extraction does not require FUSE.
      execFileSync(path.resolve(directory, name), ["--appimage-extract"], {
        cwd: temporaryDirectory,
        stdio: ["ignore", "ignore", "pipe"],
      });
      validateAppDir(path.join(temporaryDirectory, "squashfs-root"));
      console.log(`Validated AppImage icon: ${name}`);
    } catch (error) {
      throw new Error(`Invalid AppImage ${name}: ${error.message}`, { cause: error });
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Usage: node scripts/release/validate-appimage.mjs <bundle-directory>");
    }
    validateAppImages(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
