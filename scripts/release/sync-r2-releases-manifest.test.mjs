import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildIosReleaseEntry,
  matchPlatform,
  transformGitHubReleases,
} from "./sync-r2-releases-manifest.mjs";

function iosReleaseEntry(version, publishedAt) {
  return {
    version,
    tagName: `ios-ipa-v${version}`,
    publishedAt,
    isLatest: false,
    isPrerelease: true,
    category: "ios",
    releaseNotesUrl: `https://github.com/wmasfoe/md-editor/releases/tag/ios-ipa-v${version}`,
    assets: [
      {
        platform: "ios",
        platformLabel: "iOS · 未签名 IPA（自签安装）",
        fileName: `Inkpoint-${version}-unsigned.ipa`,
        downloadUrl: `https://download.justdev.cn/inkpoint/ios/${version}/Inkpoint-${version}-unsigned.ipa`,
        sizeBytes: 4300000,
        formattedSize: "4.1 MB",
        isR2Cached: true,
      },
    ],
  };
}

describe("sync-r2-releases-manifest", () => {
  it("matches various platform file extensions accurately", () => {
    assert.equal(matchPlatform("Inkpoint_0.10.2_aarch64.dmg").platform, "macos-arm64");
    assert.equal(matchPlatform("Inkpoint_0.10.2_x64.dmg").platform, "macos-x64");
    assert.equal(matchPlatform("Inkpoint_0.10.2_x64-setup.exe").platform, "windows-x64");
    assert.equal(matchPlatform("Inkpoint_0.10.2_arm64-setup.exe").platform, "windows-arm64");
    assert.equal(matchPlatform("inkpoint_0.10.2_amd64.AppImage").platform, "linux-appimage");
    assert.equal(matchPlatform("inkpoint_0.10.2_amd64.deb").platform, "linux-deb");
    assert.equal(matchPlatform("Inkpoint_0.1.0.apk").platform, "android");
    assert.equal(matchPlatform("Inkpoint-0.2.1-unsigned.ipa").platform, "ios");
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

    const manifest = transformGitHubReleases(rawMock, "inkpoint", "https://download.jiaqi.im");

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

  it("merges and preserves historical Android releases alongside newly discovered versions", () => {
    const rawDesktopMock = [
      {
        tag_name: "v0.10.2",
        published_at: "2026-09-15T12:00:00Z",
        prerelease: false,
        html_url: "https://github.com/wmasfoe/md-editor/releases/tag/v0.10.2",
        assets: [{ name: "Inkpoint_0.10.2_aarch64.dmg", size: 10000000 }],
      },
    ];

    const existingAndroidReleases = [
      {
        version: "0.1.0",
        tagName: "android-v0.1.0",
        publishedAt: "2026-09-16T12:00:00Z",
        isLatest: true,
        isPrerelease: true,
        category: "android",
        releaseNotesUrl: "https://github.com/wmasfoe/md-editor/releases/tag/android-v0.1.0",
        assets: [
          {
            platform: "android",
            platformLabel: "Android · APK (Beta)",
            fileName: "Inkpoint_0.1.0.apk",
            downloadUrl: "https://download.jiaqi.im/inkpoint/android/0.1.0/Inkpoint_0.1.0.apk",
            sizeBytes: 45000000,
            formattedSize: "43 MB",
            isR2Cached: true,
          },
        ],
      },
    ];

    const extraAndroidReleases = [
      {
        version: "0.1.1",
        tagName: "android-v0.1.1",
        publishedAt: "2026-09-17T12:00:00Z",
        isLatest: false,
        isPrerelease: true,
        category: "android",
        releaseNotesUrl: "https://github.com/wmasfoe/md-editor/releases/tag/android-v0.1.1",
        assets: [
          {
            platform: "android",
            platformLabel: "Android · APK (Beta)",
            fileName: "Inkpoint_0.1.1.apk",
            downloadUrl: "https://download.jiaqi.im/inkpoint/android/0.1.1/Inkpoint_0.1.1.apk",
            sizeBytes: 46000000,
            formattedSize: "44 MB",
            isR2Cached: true,
          },
        ],
      },
    ];

    const manifest = transformGitHubReleases(
      rawDesktopMock,
      "inkpoint",
      "https://download.jiaqi.im",
      {
        existingReleases: existingAndroidReleases,
        extraAndroidReleases,
      },
    );

    assert.equal(manifest.latestAndroidVersion, "0.1.1");
    assert.equal(manifest.latestReleases.android.version, "0.1.1");
    const androidList = manifest.releases.filter((r) => r.category === "android");
    assert.equal(androidList.length, 2);
    assert.equal(androidList[0].version, "0.1.1");
    assert.equal(androidList[0].isLatest, true);
    assert.equal(androidList[1].version, "0.1.0");
    assert.equal(androidList[1].isLatest, false);
  });
});

describe("iOS unsigned IPA releases", () => {
  it("maps .ipa artifacts to the ios platform with a self-sign label", () => {
    const matched = matchPlatform("Inkpoint-0.2.1-unsigned.ipa");
    assert.equal(matched.platform, "ios");
    assert.match(matched.platformLabel, /未签名 IPA/);
  });

  it("merges injected + previously published iOS entries without needing GitHub Releases", () => {
    const rawDesktopMock = [
      {
        tag_name: "v0.13.0",
        published_at: "2026-09-20T12:00:00Z",
        prerelease: false,
        html_url: "https://github.com/wmasfoe/md-editor/releases/tag/v0.13.0",
        assets: [{ name: "Inkpoint_0.13.0_aarch64.dmg", size: 10000000 }],
      },
    ];

    const manifest = transformGitHubReleases(
      rawDesktopMock,
      "inkpoint",
      "https://download.justdev.cn",
      {
        extraIosReleases: [
          buildIosReleaseEntry("0.2.1"),
          iosReleaseEntry("0.2.0", "2026-09-19T12:00:00Z"),
        ],
      },
    );

    assert.equal(manifest.latestIosVersion, "0.2.1");
    assert.equal(manifest.latestReleases.ios.version, "0.2.1");
    assert.equal(
      manifest.latestReleases.ios.downloadUrl,
      "https://download.justdev.cn/inkpoint/ios/latest",
    );
    assert.equal(manifest.latestReleases.ios.fileName, "Inkpoint-0.2.1-unsigned.ipa");
    assert.equal(manifest.latestReleases.ios.platformLabel, "iOS · 未签名 IPA（自签安装）");

    const iosList = manifest.releases.filter((r) => r.category === "ios");
    assert.equal(iosList.length, 2);
    assert.equal(iosList[0].version, "0.2.1");
    assert.equal(iosList[0].isLatest, true);
    assert.equal(iosList[1].version, "0.2.0");
    assert.equal(iosList[1].isLatest, false);

    // iOS 条目不能影响桌面端 Latest 判定
    assert.equal(manifest.latestDesktopVersion, "0.13.0");
  });

  it("ignores an empty IOS_RELEASE_VERSION and keeps other platforms intact", () => {
    const manifest = transformGitHubReleases(
      [
        {
          tag_name: "v0.13.0",
          published_at: "2026-09-20T12:00:00Z",
          prerelease: false,
          html_url: "https://github.com/wmasfoe/md-editor/releases/tag/v0.13.0",
          assets: [{ name: "Inkpoint_0.13.0_aarch64.dmg", size: 10000000 }],
        },
      ],
      "inkpoint",
      "https://download.justdev.cn",
      { extraIosReleases: [buildIosReleaseEntry(undefined)] },
    );

    assert.equal(buildIosReleaseEntry(undefined), null);
    assert.equal(manifest.latestIosVersion, "");
    assert.equal(
      manifest.releases.some((r) => r.category === "ios"),
      false,
    );
    assert.equal(manifest.releases.length, 1);
  });
});

describe("matchPlatform linux arch labels", () => {
  it("labels aarch64 artifacts as ARM64 (aarch64 contains no arm64 substring)", () => {
    assert.equal(
      matchPlatform("Inkpoint_0.12.1_aarch64.AppImage").platformLabel,
      "Linux (ARM64) · AppImage",
    );
    assert.equal(matchPlatform("Inkpoint_0.12.1_arm64.deb").platformLabel, "Linux (ARM64) · DEB");
    assert.equal(
      matchPlatform("Inkpoint_0.12.1_amd64.AppImage").platformLabel,
      "Linux (x86_64) · AppImage",
    );
    assert.equal(matchPlatform("Inkpoint_0.12.1_amd64.deb").platformLabel, "Linux (x86_64) · DEB");
  });
});
