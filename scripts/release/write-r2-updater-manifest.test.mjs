import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateR2UpdaterManifest,
  resolveUpdaterArtifacts,
} from "./write-r2-updater-manifest.mjs";

/** 在临时目录里放置同名文件，跑完即清理；用于验证发布链路对 artifacts 目录的解析。 */
function withArtifacts(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-updater-artifacts-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("generateR2UpdaterManifest", () => {
  it("throws error when version is missing", () => {
    assert.throws(() => generateR2UpdaterManifest({}), /Missing version/);
  });

  it("generates correct updater manifest with macOS signature", () => {
    const manifest = generateR2UpdaterManifest({
      version: "v0.10.2",
      distributionUrl: "https://download.jiaqi.im",
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
      "https://download.jiaqi.im/inkpoint/desktop/0.10.2/Inkpoint.app.tar.gz",
    );
  });

  it("generates correct updater manifest with both mac and windows", () => {
    const manifest = generateR2UpdaterManifest({
      version: "0.10.2",
      distributionUrl: "https://download.jiaqi.im",
      appName: "inkpoint",
      macTarName: "Inkpoint.app.tar.gz",
      macSignature: "test-mac-sig",
      winUpdaterName: "Inkpoint_0.10.2_x64-setup.nsis.zip",
      winSignature: "test-win-sig",
    });

    assert.equal(
      manifest.platforms["windows-x86_64"].url,
      "https://download.jiaqi.im/inkpoint/desktop/0.10.2/Inkpoint_0.10.2_x64-setup.nsis.zip",
    );
    assert.equal(manifest.platforms["windows-x86_64"].signature, "test-win-sig");
  });
});

describe("resolveUpdaterArtifacts", () => {
  it("把 Tauri v2 的 NSIS 安装器本体识别为 Windows 更新产物", () => {
    // 回归：此前只匹配 `.nsis.zip`，Windows 构建实际只产出 `<...>_x64-setup.exe` + `.sig`，
    // 导致 windows-x86_64 条目长期缺失、Windows 收不到应用内更新。
    withArtifacts(
      {
        "Inkpoint_0.13.2_x64-setup.exe": "installer-bytes",
        "Inkpoint_0.13.2_x64-setup.exe.sig": "win-signature",
      },
      (dir) => {
        const resolved = resolveUpdaterArtifacts(dir, {});
        assert.equal(resolved.winUpdaterName, "Inkpoint_0.13.2_x64-setup.exe");
        assert.equal(resolved.winSignature, "win-signature");
      },
    );
  });

  it("优先使用 `.nsis.zip`（上游若重新产出该形态）", () => {
    withArtifacts(
      {
        "Inkpoint_0.13.2_x64-setup.exe": "installer-bytes",
        "Inkpoint_0.13.2_x64-setup.exe.sig": "exe-signature",
        "Inkpoint_0.13.2_x64-setup.nsis.zip": "zip-bytes",
        "Inkpoint_0.13.2_x64-setup.nsis.zip.sig": "zip-signature",
      },
      (dir) => {
        const resolved = resolveUpdaterArtifacts(dir, {});
        assert.ok(resolved.winUpdaterName.endsWith(".nsis.zip"));
        assert.equal(resolved.winSignature, "zip-signature");
      },
    );
  });

  it("同时解析 macOS 更新包与签名", () => {
    withArtifacts(
      {
        "Inkpoint.app.tar.gz": "app-bytes",
        "Inkpoint.app.tar.gz.sig": "mac-signature",
      },
      (dir) => {
        const resolved = resolveUpdaterArtifacts(dir, {});
        assert.equal(resolved.macTarName, "Inkpoint.app.tar.gz");
        assert.equal(resolved.macSignature, "mac-signature");
      },
    );
  });

  it("完全不误匹配 Windows ARM64 安装包", () => {
    withArtifacts(
      {
        "Inkpoint_0.13.2_arm64-setup.exe": "arm-bytes",
        "Inkpoint_0.13.2_arm64-setup.exe.sig": "arm-signature",
      },
      (dir) => {
        const resolved = resolveUpdaterArtifacts(dir, {});
        assert.equal(resolved.winUpdaterName, undefined);
      },
    );
  });

  it("缺少产物时回退到环境变量而不是抛错", () => {
    withArtifacts({}, (dir) => {
      const resolved = resolveUpdaterArtifacts(dir, {
        MAC_UPDATER_SIGNATURE: "env-mac",
        WIN_UPDATER_SIGNATURE: "env-win",
      });
      assert.equal(resolved.macSignature, "env-mac");
      assert.equal(resolved.winSignature, "env-win");
    });
  });
});
