import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchPlatform, transformGitHubReleases } from "./sync-r2-releases-manifest.mjs";

describe("sync-r2-releases-manifest", () => {
  it("matches various platform file extensions accurately", () => {
    assert.equal(matchPlatform("Inkpoint_0.10.2_aarch64.dmg").platform, "macos-arm64");
    assert.equal(matchPlatform("Inkpoint_0.10.2_x64.dmg").platform, "macos-x64");
    assert.equal(matchPlatform("Inkpoint_0.10.2_x64-setup.exe").platform, "windows-x64");
    assert.equal(matchPlatform("Inkpoint_0.10.2_arm64-setup.exe").platform, "windows-arm64");
    assert.equal(matchPlatform("inkpoint_0.10.2_amd64.AppImage").platform, "linux-appimage");
    assert.equal(matchPlatform("inkpoint_0.10.2_amd64.deb").platform, "linux-deb");
    assert.equal(matchPlatform("Inkpoint_0.1.0.apk").platform, "android");
    assert.equal(matchPlatform("Inkpoint.app.tar.gz.sig").platform, "updater");
    assert.equal(matchPlatform("unknown.txt").platform, "other");
  });

  it("transforms raw GitHub releases into ReleasesManifest schema", () => {
    const rawMock = [
      {
        tag_name: "v0.10.2",
        published_at: "2026-09-15T12:00:00Z",
        prerelease: false,
        html_url: "https://github.com/wmasfoe/md-editor/releases/tag/v0.10.2",
        assets: [
          {
            name: "Inkpoint_0.10.2_aarch64.dmg",
            size: 10485760,
          },
          {
            name: "Inkpoint_0.10.2_x64-setup.exe",
            size: 20971520,
          },
        ],
      },
      {
        tag_name: "android-v0.1.0",
        published_at: "2026-09-14T12:00:00Z",
        prerelease: false,
        html_url: "https://github.com/wmasfoe/md-editor/releases/tag/android-v0.1.0",
        assets: [
          {
            name: "Inkpoint_0.1.0.apk",
            size: 45000000,
          },
        ],
      },
    ];

    const manifest = transformGitHubReleases(rawMock, "inkpoint", "https://download.justdev.cn");

    assert.equal(manifest.app, "inkpoint");
    assert.equal(manifest.total, 2);
    assert.equal(manifest.latestDesktopVersion, "0.10.2");
    assert.equal(manifest.latestAndroidVersion, "0.1.0");
    assert.equal(manifest.releases.length, 2);

    const desktop = manifest.releases[0];
    assert.equal(desktop.version, "0.10.2");
    assert.equal(desktop.category, "desktop");
    assert.equal(desktop.isLatest, true);
    assert.equal(desktop.assets.length, 2);
    assert.equal(desktop.assets[0].platform, "macos-arm64");

    const android = manifest.releases[1];
    assert.equal(android.version, "0.1.0");
    assert.equal(android.category, "android");
    assert.equal(android.assets[0].platform, "android");
  });
});
