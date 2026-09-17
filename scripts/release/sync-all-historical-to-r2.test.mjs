import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncSingleAssetToR2 } from "./sync-all-historical-to-r2.mjs";

describe("sync-all-historical-to-r2", () => {
  it("generates correct r2Key and handles dryRun without network", async () => {
    const assetMock = {
      name: "Inkpoint_0.9.0_aarch64.dmg",
      size: 29000000,
      browser_download_url: "https://example.com/test.dmg",
    };

    const res = await syncSingleAssetToR2({
      asset: assetMock,
      version: "0.9.0",
      isAndroid: false,
      dryRun: true,
      bucket: "test-bucket",
      app: "inkpoint",
      tmpDir: "scratch/test-tmp",
    });

    assert.equal(res.status, "dry-run");
    assert.equal(res.r2Key, "inkpoint/desktop/0.9.0/Inkpoint_0.9.0_aarch64.dmg");
  });

  it("handles android device category in r2Key path", async () => {
    const assetMock = {
      name: "Inkpoint_0.1.0.apk",
      size: 45000000,
      browser_download_url: "https://example.com/test.apk",
    };

    const res = await syncSingleAssetToR2({
      asset: assetMock,
      version: "0.1.0",
      isAndroid: true,
      dryRun: true,
      bucket: "test-bucket",
      app: "inkpoint",
      tmpDir: "scratch/test-tmp",
    });

    assert.equal(res.status, "dry-run");
    assert.equal(res.r2Key, "inkpoint/android/0.1.0/Inkpoint_0.1.0.apk");
  });
});
