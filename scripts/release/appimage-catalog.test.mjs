import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AARCH64_UPDATE_INFORMATION,
  AMD64_UPDATE_INFORMATION,
  EXCLUDED_LIBRARY,
  GTK_PLUGIN_URL,
  HOOK_FILENAME,
  HOOK_SOURCE,
  LINUXDEPLOY_DOWNLOAD_ROOT,
  WRAPPER_MARKER,
  WRAPPER_SOURCE,
  expectedUpdateInformation,
  linuxdeployCacheName,
  patchGtkPluginScript,
  prepareLinuxDeployTools,
  prependLibraryDirectory,
  readAppImageUpdateInformation,
  readZsyncFilename,
  updateInformationForArch,
} from "./appimage-catalog.mjs";
import { validateEmbeddedUpdateInformation } from "./validate-appimage.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const linuxGcc = process.platform === "linux" && hasCommand("gcc");

function hasCommand(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

const originalGtkLine =
  'env LINUXDEPLOY_PLUGIN_MODE=1 "$LINUXDEPLOY" --appdir="$APPDIR" "${LIBRARIES[@]}"';

test("update information matches the GitHub release asset globs", () => {
  assert.equal(
    AMD64_UPDATE_INFORMATION,
    "gh-releases-zsync|wmasfoe|md-editor|latest|Inkpoint_*_amd64.AppImage.zsync",
  );
  assert.equal(
    AARCH64_UPDATE_INFORMATION,
    "gh-releases-zsync|wmasfoe|md-editor|latest|Inkpoint_*_aarch64.AppImage.zsync",
  );
  assert.equal(updateInformationForArch("x86_64"), AMD64_UPDATE_INFORMATION);
  assert.equal(updateInformationForArch("aarch64"), AARCH64_UPDATE_INFORMATION);
  assert.equal(
    expectedUpdateInformation("Inkpoint_0.16.3_amd64.AppImage"),
    AMD64_UPDATE_INFORMATION,
  );
  assert.equal(
    expectedUpdateInformation("Inkpoint_0.16.3_aarch64.AppImage"),
    AARCH64_UPDATE_INFORMATION,
  );
  assert.equal(expectedUpdateInformation("Example_1.0.0_amd64.AppImage"), AMD64_UPDATE_INFORMATION);

  const tauri = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
  );
  assert.equal(tauri.productName, "Inkpoint");
  assert.equal(
    tauri.bundle.linux.appimage.files["usr/share/metainfo/dev.md_editor.app.appdata.xml"],
    "linux/dev.md_editor.app.appdata.xml",
  );
  const metainfo = fs.readFileSync(
    path.join(repoRoot, "apps/desktop/src-tauri/linux/dev.md_editor.app.appdata.xml"),
    "utf8",
  );
  assert.match(metainfo, /<id>dev\.md_editor\.app<\/id>/u);
  assert.match(metainfo, /<launchable type="desktop-id">Inkpoint\.desktop<\/launchable>/u);
  assert.match(metainfo, /<project_license>GPL-3\.0-or-later<\/project_license>/u);
  assert.match(metainfo, /<name>Inkpoint<\/name>/u);
});

test("LICENSE is the canonical GPL-3.0 text and NOTICE has no extra terms", () => {
  const license = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
  const notice = fs.readFileSync(path.join(repoRoot, "NOTICE"), "utf8");
  assert.match(license, /^ {20}GNU GENERAL PUBLIC LICENSE\n {23}Version 3, 29 June 2007\n/u);
  assert.doesNotMatch(license.slice(0, 200), /Inkpoint/u);
  assert.match(license, /How to Apply These Terms to Your New Programs/u);
  assert.match(notice, /Copyright \(C\) 2026 Inkpoint Contributors/u);
  assert.match(notice, /any later version/u);
  assert.doesNotMatch(notice, /App Store/u);
  assert.doesNotMatch(notice, /additional permission/iu);
  assert.doesNotMatch(notice, /special exception/iu);
});

test("pull requests build the Linux AppImage before All Checks Passed", () => {
  const build = fs.readFileSync(path.join(repoRoot, ".github/workflows/build-desktop.yml"), "utf8");
  const job = build.split("build-linux-appimage:")[1]?.split("\n  build-desktop:")[0] ?? "";
  assert.match(job, /github\.event_name == 'pull_request'/u);
  assert.match(job, /pnpm build:linux/u);
  assert.match(build, /needs:[\s\S]*- build-linux-appimage/u);
  assert.doesNotMatch(job, /github\.event_name == 'workflow_dispatch'\s*$/mu);
});

test("release workflows upload zsync assets without sending them to the Homebrew tap", () => {
  const release = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/release-desktop.yml"),
    "utf8",
  );
  const beta = fs.readFileSync(path.join(repoRoot, ".github/workflows/release-beta.yml"), "utf8");
  const build = fs.readFileSync(path.join(repoRoot, ".github/workflows/build-desktop.yml"), "utf8");
  for (const source of [release, beta, build]) {
    assert.match(source, /\*\.AppImage\.zsync/u);
  }
  const homebrew = release.split("Publish public Homebrew asset")[1].split("Sync Cask")[0];
  assert.doesNotMatch(homebrew, /AppImage\.zsync/u);
});

test("sidecar library directory is prepended to LD_LIBRARY_PATH", () => {
  assert.equal(prependLibraryDirectory(undefined, "/opt/binaries"), "/opt/binaries");
  assert.equal(prependLibraryDirectory("", "/opt/binaries"), "/opt/binaries");
  assert.equal(prependLibraryDirectory("/opt/binaries", "/opt/binaries"), "/opt/binaries");
  assert.equal(
    prependLibraryDirectory("/exec-daemon/tmux-root/lib", "/opt/binaries"),
    "/opt/binaries:/exec-daemon/tmux-root/lib",
  );
});

test("GTK plugin patch adds the exclude flag once", () => {
  const patched = patchGtkPluginScript(`#!/bin/bash\n${originalGtkLine}\n`);
  assert.match(patched, new RegExp(`--exclude-library ${EXCLUDED_LIBRARY.replaceAll(".", "\\.")}`));
  assert.equal(patchGtkPluginScript(patched), patched);
  assert.throws(() => patchGtkPluginScript("#!/bin/bash\necho unchanged\n"), /no longer contains/u);
});

test("prepareLinuxDeployTools wraps a cached upstream AppImage and patches GTK", () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-linuxdeploy-"));
  const downloaded = [];
  fs.writeFileSync(path.join(cacheDir, "linuxdeploy-x86_64.AppImage"), "upstream-bytes", {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(cacheDir, "linuxdeploy-plugin-gtk.sh"),
    `#!/bin/bash\n${originalGtkLine}\n`,
    {
      mode: 0o755,
    },
  );
  const prepared = prepareLinuxDeployTools({
    cacheDir,
    arch: "x86_64",
    platform: "linux",
    download: (url, destination) => {
      downloaded.push(url);
      fs.writeFileSync(destination, "downloaded");
    },
    compileWrapper: (output) => {
      fs.writeFileSync(output, `ELF ${WRAPPER_MARKER}\n`, { mode: 0o755 });
    },
    compileHook: (output) => {
      fs.writeFileSync(output, "hook", { mode: 0o755 });
    },
  });
  assert.equal(downloaded.length, 0);
  assert.equal(fs.readFileSync(`${prepared.cachePath}.real`, "utf8"), "upstream-bytes");
  assert.match(fs.readFileSync(prepared.cachePath, "utf8"), new RegExp(WRAPPER_MARKER));
  assert.match(
    fs.readFileSync(prepared.gtkPluginPath, "utf8"),
    /--exclude-library libwayland-client\.so\.0/u,
  );
  assert.equal(linuxdeployCacheName("x86_64"), "linuxdeploy-x86_64.AppImage");
  assert.equal(
    `${LINUXDEPLOY_DOWNLOAD_ROOT}/linuxdeploy-aarch64.AppImage`.includes("linuxdeploy-aarch64"),
    true,
  );
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("prepareLinuxDeployTools downloads a missing upstream AppImage", () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-linuxdeploy-"));
  const downloaded = [];
  const prepared = prepareLinuxDeployTools({
    cacheDir,
    arch: "aarch64",
    platform: "linux",
    download: (url, destination) => {
      downloaded.push(url);
      fs.writeFileSync(
        destination,
        url.includes("gtk") ? `#!/bin/bash\n${originalGtkLine}\n` : "real",
      );
    },
    compileWrapper: (output) => fs.writeFileSync(output, WRAPPER_MARKER, { mode: 0o755 }),
    compileHook: (output) => fs.writeFileSync(output, "hook", { mode: 0o755 }),
  });
  assert.deepEqual(downloaded, [
    `${LINUXDEPLOY_DOWNLOAD_ROOT}/linuxdeploy-aarch64.AppImage`,
    GTK_PLUGIN_URL,
  ]);
  assert.equal(path.basename(prepared.hookPath), HOOK_FILENAME);
  assert.equal(fs.statSync(prepared.gtkPluginPath).mode & 0o777, 0o755);
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("linuxdeploy wrapper and hook exclude only the linuxdeploy tool", { skip: !linuxGcc }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-ld-hook-"));
  const hook = path.join(dir, HOOK_FILENAME);
  const wrapper = path.join(dir, "linuxdeploy-x86_64.AppImage");
  execFileSync("gcc", ["-shared", "-fPIC", "-O2", "-o", hook, HOOK_SOURCE, "-ldl"]);
  execFileSync("gcc", ["-O2", "-o", wrapper, WRAPPER_SOURCE]);
  fs.chmodSync(wrapper, 0o755);
  assert.ok(fs.readFileSync(wrapper).includes(Buffer.from(WRAPPER_MARKER)));

  const record = path.join(dir, "record.txt");
  const real = `${wrapper}.real`;
  fs.writeFileSync(
    real,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\nprintf 'LD_PRELOAD=%s\\n' "\${LD_PRELOAD-}" >> ${JSON.stringify(record)}\n`,
    { mode: 0o755 },
  );
  const wrapped = spawnSync(wrapper, ["--appimage-extract-and-run", "--plugin", "gtk"], {
    encoding: "utf8",
  });
  assert.equal(wrapped.status, 0, wrapped.stderr);
  const wrappedRecord = fs.readFileSync(record, "utf8");
  assert.match(
    wrappedRecord,
    /--appimage-extract-and-run\n--plugin\ngtk\n--exclude-library\nlibwayland-client\.so\.0\n/u,
  );
  assert.match(wrappedRecord, new RegExp(`LD_PRELOAD=${hook}`));

  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const script = `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`;
  for (const name of ["linuxdeploy", "linuxdeploy-plugin-gtk.sh", "appimagetool"]) {
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  }
  const runner = path.join(dir, "runner.c");
  fs.writeFileSync(
    runner,
    "#include <unistd.h>\nint main(int argc, char **argv){execv(argv[1], argv+1);return 127;}\n",
  );
  const runnerBin = path.join(dir, "runner");
  execFileSync("gcc", ["-O2", "-o", runnerBin, runner]);
  fs.writeFileSync(record, "");
  const injected = spawnSync(runnerBin, [path.join(bin, "linuxdeploy"), "--appdir", "/tmp/app"], {
    env: { ...process.env, LD_PRELOAD: hook },
    encoding: "utf8",
  });
  assert.equal(injected.status, 0, injected.stderr);
  assert.match(fs.readFileSync(record, "utf8"), /--exclude-library\nlibwayland-client\.so\.0/u);

  fs.writeFileSync(record, "");
  const plugin = spawnSync(
    runnerBin,
    [path.join(bin, "linuxdeploy-plugin-gtk.sh"), "--appdir", "/tmp/app"],
    {
      env: { ...process.env, LD_PRELOAD: hook },
      encoding: "utf8",
    },
  );
  assert.equal(plugin.status, 0, plugin.stderr);
  assert.equal(fs.readFileSync(record, "utf8").trim(), "--appdir\n/tmp/app");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("Inkpoint metainfo validates with appstreamcli", { skip: !hasCommand("appstreamcli") }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-appstream-"));
  const metainfoDir = path.join(root, "usr/share/metainfo");
  const applicationsDir = path.join(root, "usr/share/applications");
  const iconDir = path.join(root, "usr/share/icons/hicolor/128x128/apps");
  fs.mkdirSync(metainfoDir, { recursive: true });
  fs.mkdirSync(applicationsDir, { recursive: true });
  fs.mkdirSync(iconDir, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "apps/desktop/src-tauri/linux/dev.md_editor.app.appdata.xml"),
    path.join(metainfoDir, "dev.md_editor.app.appdata.xml"),
  );
  fs.copyFileSync(
    path.join(repoRoot, "apps/desktop/src-tauri/icons/128x128.png"),
    path.join(iconDir, "md-editor.png"),
  );
  fs.writeFileSync(
    path.join(applicationsDir, "Inkpoint.desktop"),
    `[Desktop Entry]
Categories=Office;
Comment=Daily-usable Markdown and MDX desktop editor
Exec=md-editor
Icon=md-editor
Name=Inkpoint
StartupWMClass=md-editor
Terminal=false
Type=Application
MimeType=text/markdown;
`,
  );
  const result = spawnSync("appstreamcli", ["validate-tree", "--no-net", root], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Minimal ELF64 with one named payload section. Enough for the section walker;
 * it is not a runnable AppImage. The payload is NUL-padded the way appimagetool
 * pads `.upd_info`.
 */
function writeElf64WithSection(filePath, sectionName, text) {
  const payload = Buffer.concat([Buffer.from(text, "utf8"), Buffer.alloc(8)]);
  const names = Buffer.from(`\0${sectionName}\0.shstrtab\0`, "utf8");
  const sectionNameOffset = 1;
  const stringTableOffset = sectionNameOffset + Buffer.byteLength(sectionName) + 1;
  const payloadOffset = 64;
  const namesOffset = payloadOffset + payload.length;
  const sectionOffset = Math.ceil((namesOffset + names.length) / 8) * 8;
  const sectionCount = 3;
  const file = Buffer.alloc(sectionOffset + sectionCount * 64);
  file[0] = 0x7f;
  file.write("ELF", 1, "ascii");
  file[4] = 2;
  file[5] = 1;
  file[6] = 1;
  file.writeUInt16LE(2, 16);
  file.writeUInt16LE(62, 18);
  file.writeUInt32LE(1, 20);
  file.writeBigUInt64LE(BigInt(sectionOffset), 40);
  file.writeUInt16LE(64, 52);
  file.writeUInt16LE(64, 58);
  file.writeUInt16LE(sectionCount, 60);
  file.writeUInt16LE(2, 62);
  payload.copy(file, payloadOffset);
  names.copy(file, namesOffset);

  const writeSection = (index, name, type, offset, size) => {
    const at = sectionOffset + index * 64;
    file.writeUInt32LE(name, at);
    file.writeUInt32LE(type, at + 4);
    file.writeBigUInt64LE(BigInt(offset), at + 24);
    file.writeBigUInt64LE(BigInt(size), at + 32);
    file.writeBigUInt64LE(1n, at + 48);
  };
  writeSection(1, sectionNameOffset, 1, payloadOffset, payload.length);
  writeSection(2, stringTableOffset, 3, namesOffset, names.length);
  fs.writeFileSync(filePath, file);
}

test("update information is read from the ELF section and the zsync filename", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-upd-info-"));
  const name = "Inkpoint_0.16.4_amd64.AppImage";
  const imagePath = path.join(root, name);
  writeElf64WithSection(imagePath, ".upd_info", AMD64_UPDATE_INFORMATION);
  fs.writeFileSync(`${imagePath}.zsync`, `zsync: 0.6.2\nFilename: ${name}\n\nnot-really-binary`);
  const previous = process.env.APPIMAGE_EXTRACT_AND_RUN;
  process.env.APPIMAGE_EXTRACT_AND_RUN = "1";
  try {
    assert.equal(readAppImageUpdateInformation(imagePath), AMD64_UPDATE_INFORMATION);
    assert.equal(readZsyncFilename(`${imagePath}.zsync`), name);
    assert.doesNotThrow(() => validateEmbeddedUpdateInformation(imagePath, name));
    fs.rmSync(`${imagePath}.zsync`);
    assert.throws(() => validateEmbeddedUpdateInformation(imagePath, name), /zsync is missing/u);
  } finally {
    if (previous === undefined) delete process.env.APPIMAGE_EXTRACT_AND_RUN;
    else process.env.APPIMAGE_EXTRACT_AND_RUN = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an ELF AppImage without .upd_info is rejected and a script is ignored", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-upd-info-missing-"));
  const imagePath = path.join(root, "Inkpoint_0.16.4_aarch64.AppImage");
  writeElf64WithSection(imagePath, ".note", AARCH64_UPDATE_INFORMATION);
  assert.throws(() => readAppImageUpdateInformation(imagePath), /\.upd_info/u);

  const scriptPath = path.join(root, "Example_1.0.0_amd64.AppImage");
  fs.writeFileSync(scriptPath, "#!/usr/bin/env node\nprocess.exit(2)\n", { mode: 0o755 });
  assert.equal(readAppImageUpdateInformation(scriptPath), null);
  assert.doesNotThrow(() =>
    validateEmbeddedUpdateInformation(scriptPath, path.basename(scriptPath)),
  );
  fs.rmSync(root, { recursive: true, force: true });
});
