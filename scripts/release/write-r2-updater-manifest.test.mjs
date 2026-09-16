import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateR2UpdaterManifest } from "./write-r2-updater-manifest.mjs";

describe("generateR2UpdaterManifest", () => {
  it("throws error when version is missing", () => {
    assert.throws(() => generateR2UpdaterManifest({}), /Missing version/);
  });

  it("generates correct updater manifest with macOS signature", () => {
    const manifest = generateR2UpdaterManifest({
      version: "v0.10.2",
      distributionUrl: "https://download.justdev.cn",
      appName: "inkpoint",
      macTarName: "Inkpoint.app.tar.gz",
      macSignature: "test-mac-sig",
    });

    assert.equal(manifest.version, "0.10.2");
    assert.equal(manifest.notes, "Inkpoint 0.10.2");
    assert.ok(manifest.platforms["darwin-aarch64"]);
    assert.equal(manifest.platforms["darwin-aarch64"].signature, "test-mac-sig");
    assert.equal(
      manifest.platforms["darwin-aarch64"].url,
      "https://download.justdev.cn/inkpoint/desktop/0.10.2/Inkpoint.app.tar.gz",
    );
  });

  it("generates correct updater manifest with both mac and windows", () => {
    const manifest = generateR2UpdaterManifest({
      version: "0.10.2",
      distributionUrl: "https://download.justdev.cn",
      appName: "inkpoint",
      macTarName: "Inkpoint.app.tar.gz",
      macSignature: "test-mac-sig",
      winZipName: "Inkpoint_0.10.2_x64-setup.nsis.zip",
      winSignature: "test-win-sig",
    });

    assert.equal(
      manifest.platforms["windows-x86_64"].url,
      "https://download.justdev.cn/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_x64-setup.nsis.zip",
    );
    assert.equal(manifest.platforms["windows-x86_64"].signature, "test-win-sig");
  });
});
