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
          downloadUrl: "https://download.justdev.cn/inkpoint/android/latest",
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
            downloadUrl: "https://download.justdev.cn/inkpoint/desktop/macos/latest",
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
      "https://download.justdev.cn/inkpoint/desktop/macos/latest",
    );
  });
});
