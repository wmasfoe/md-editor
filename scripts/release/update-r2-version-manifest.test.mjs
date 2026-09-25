import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeVersionManifest } from "./update-r2-version-manifest.mjs";

describe("mergeVersionManifest", () => {
  it("preserves android and ios when merging desktop", () => {
    const existing = {
      app: "inkpoint",
      updatedAt: "2026-09-16T10:00:00Z",
      android: {
        version: "0.1.0",
        apk: {
          version: "0.1.0",
          fileName: "Inkpoint_0.1.0.apk",
          downloadUrl: "https://download.jiaqi.im/inkpoint/android/latest",
        },
      },
      ios: {
        version: "0.1.0",
        testFlightUrl: "https://testflight.apple.com/placeholder",
      },
    };

    const desktopData = {
      desktop: {
        version: "0.10.2",
        releaseNotesUrl: "https://github.com/wmasfoe/md-editor/releases/tag/v0.10.2",
        assets: {
          macos_arm64: {
            version: "0.10.2",
            fileName: "Inkpoint_0.10.2_aarch64.dmg",
            downloadUrl: "https://download.jiaqi.im/inkpoint/desktop/macos/latest",
          },
        },
      },
    };

    const merged = mergeVersionManifest(existing, desktopData);
    assert.equal(merged.app, "inkpoint");
    assert.ok(merged.updatedAt);
    assert.equal(merged.android.version, "0.1.0");
    assert.equal(merged.ios.version, "0.1.0");
    assert.equal(merged.desktop.version, "0.10.2");
    assert.equal(
      merged.desktop.assets.macos_arm64.downloadUrl,
      "https://download.jiaqi.im/inkpoint/desktop/macos/latest",
    );
  });

  it("preserves desktop and ios when merging android", () => {
    const existing = {
      app: "inkpoint",
      updatedAt: "2026-09-16T10:00:00Z",
      desktop: {
        version: "0.10.2",
        assets: {},
      },
      ios: {
        version: "0.1.0",
      },
    };

    const androidData = {
      android: {
        version: "0.2.0",
        apk: {
          version: "0.2.0",
          fileName: "Inkpoint_0.2.0.apk",
          downloadUrl: "https://download.jiaqi.im/inkpoint/android/latest",
        },
      },
    };

    const merged = mergeVersionManifest(existing, androidData);
    assert.equal(merged.app, "inkpoint");
    assert.equal(merged.desktop.version, "0.10.2");
    assert.equal(merged.android.version, "0.2.0");
    assert.equal(merged.ios.version, "0.1.0");
  });
});

describe("runCli linux arch slots", () => {
  it("assigns x64 and ARM64 artifacts to their own slots regardless of directory order", async () => {
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { runCli } = await import("./update-r2-version-manifest.mjs");

    const dir = mkdtempSync(join(tmpdir(), "inkpoint-artifacts-"));
    const outDir = mkdtempSync(join(tmpdir(), "inkpoint-manifest-"));
    // ARM 构建刻意先写入，旧代码按 readdir 首个命中会把 ARM 包塞进 x64 槽位。
    const files = [
      "Inkpoint_0.12.1_aarch64.AppImage",
      "Inkpoint_0.12.1_arm64.deb",
      "Inkpoint_0.12.1_amd64.AppImage",
      "Inkpoint_0.12.1_amd64.deb",
      "Inkpoint_0.12.1_aarch64.dmg",
      "Inkpoint_0.12.1_x64-setup.exe",
    ];
    for (const name of files) {
      writeFileSync(join(dir, name), `fake-${name}`);
    }

    const savedEnv = { ...process.env };
    process.env.RELEASE_VERSION = "0.12.1";
    process.env.RELEASE_PLATFORM = "desktop";
    process.env.ARTIFACTS_DIR = dir;
    process.env.OUTPUT_PATH = join(outDir, "version.json");
    // 指向关闭端口，使远端清单拉取快速失败，走本地基线。
    process.env.DISTRIBUTION_URL = "http://127.0.0.1:9";
    process.env.APP_NAME = "inkpoint";
    try {
      await runCli();
    } finally {
      process.env = savedEnv;
    }

    const manifest = JSON.parse(readFileSync(join(outDir, "version.json"), "utf8"));
    const assets = manifest.desktop.assets;
    assert.equal(assets.linux_appimage.fileName, "Inkpoint_0.12.1_amd64.AppImage");
    assert.equal(assets.linux_appimage_arm64.fileName, "Inkpoint_0.12.1_aarch64.AppImage");
    assert.equal(assets.linux_deb.fileName, "Inkpoint_0.12.1_amd64.deb");
    assert.equal(assets.linux_deb_arm64.fileName, "Inkpoint_0.12.1_arm64.deb");
    assert.equal(
      assets.linux_appimage_arm64.downloadUrl,
      "http://127.0.0.1:9/inkpoint/desktop/linux-arm64/latest",
    );
    assert.equal(
      assets.linux_deb_arm64.downloadUrl,
      "http://127.0.0.1:9/inkpoint/desktop/linux-deb-arm64/latest",
    );

    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
});
