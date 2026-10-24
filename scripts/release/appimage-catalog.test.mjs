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
  updateInformationForArch,
} from "./appimage-catalog.mjs";

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

test("LICENSE is the canonical GPL-3.0 text and the App Store grant lives in NOTICE", () => {
  const license = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
  const notice = fs.readFileSync(path.join(repoRoot, "NOTICE"), "utf8");
  assert.match(license, /^ {20}GNU GENERAL PUBLIC LICENSE\n {23}Version 3, 29 June 2007\n/u);
  assert.doesNotMatch(license.slice(0, 200), /Inkpoint/u);
  assert.match(license, /How to Apply These Terms to Your New Programs/u);
  assert.match(notice, /Apple App Store Exception/u);
  assert.match(notice, /any later version/u);
  assert.match(notice, /Copyright \(C\) 2026 Inkpoint Contributors/u);
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
