import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateUpdaterManifest,
  r2UrlFor,
  resolveUpdaterArtifacts,
  tapUrlFor,
} from "./write-r2-updater-manifest.mjs";

/** 在临时目录里放置同名文件（可带子目录），跑完即清理；用于验证发布链路对 artifacts 目录的解析。 */
function withArtifacts(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-updater-artifacts-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 0.21.0 发版时 CI 实际下载到的 artifacts 布局（含 Linux 签名）。 */
const RELEASE_ARTIFACTS = {
  "artifacts-macos/macos/Inkpoint.app.tar.gz": "mac",
  "artifacts-macos/macos/Inkpoint.app.tar.gz.sig": "mac-sig\n",
  "artifacts-macos/dmg/Inkpoint_0.21.0_aarch64.dmg": "dmg",
  "artifacts-windows-x64/Inkpoint_0.21.0_x64-setup.exe": "win",
  "artifacts-windows-x64/Inkpoint_0.21.0_x64-setup.exe.sig": "win-sig",
  "artifacts-linux-x64/appimage/Inkpoint_0.21.0_amd64.AppImage": "appimage",
  "artifacts-linux-x64/appimage/Inkpoint_0.21.0_amd64.AppImage.sig": "appimage-sig",
  "artifacts-linux-x64/appimage/Inkpoint_0.21.0_amd64.AppImage.zsync": "zsync",
  "artifacts-linux-x64/deb/Inkpoint_0.21.0_amd64.deb": "deb",
  "artifacts-linux-x64/deb/Inkpoint_0.21.0_amd64.deb.sig": "deb-sig",
  "artifacts-linux-arm64/appimage/Inkpoint_0.21.0_aarch64.AppImage": "arm-appimage",
  "artifacts-linux-arm64/appimage/Inkpoint_0.21.0_aarch64.AppImage.sig": "arm-appimage-sig",
  "artifacts-linux-arm64/deb/Inkpoint_0.21.0_arm64.deb": "arm-deb",
  "artifacts-linux-arm64/deb/Inkpoint_0.21.0_arm64.deb.sig": "arm-deb-sig",
};

function manifestFor(dir, urlFor = r2UrlFor("https://download.jiaqi.im", "inkpoint")) {
  return generateUpdaterManifest({
    version: "v0.21.0",
    notes: "## 0.21.0\n\n- item",
    artifacts: resolveUpdaterArtifacts(dir),
    urlFor,
  });
}

describe("generateUpdaterManifest", () => {
  it("throws error when version is missing", () => {
    assert.throws(
      () => generateUpdaterManifest({ artifacts: [], urlFor: () => "" }),
      /Missing version/,
    );
  });

  it("falls back to a version-only note when notes are missing", () => {
    const manifest = generateUpdaterManifest({
      version: "0.21.0",
      artifacts: [],
      urlFor: () => "",
    });
    assert.equal(manifest.notes, "Inkpoint 0.21.0");
  });

  it("covers macOS, Windows and both Linux architectures for AppImage and deb", () => {
    withArtifacts(RELEASE_ARTIFACTS, (dir) => {
      const manifest = manifestFor(dir);
      assert.equal(manifest.version, "0.21.0");
      assert.deepEqual(Object.keys(manifest.platforms).toSorted(), [
        "darwin-aarch64",
        "darwin-aarch64-app",
        "linux-aarch64",
        "linux-aarch64-appimage",
        "linux-aarch64-deb",
        "linux-x86_64",
        "linux-x86_64-appimage",
        "linux-x86_64-deb",
        "windows-x86_64",
        "windows-x86_64-nsis",
      ]);
    });
  });

  it("points deb installs at the deb package, never at the AppImage", () => {
    // 插件先查 `{os}-{arch}-deb`：缺失时会落到裸键拿到 AppImage，再 `dpkg -i` 失败。
    withArtifacts(RELEASE_ARTIFACTS, (dir) => {
      const { platforms } = manifestFor(dir);
      assert.equal(
        platforms["linux-x86_64-deb"].url,
        "https://download.jiaqi.im/inkpoint/desktop/0.21.0/Inkpoint_0.21.0_amd64.deb",
      );
      assert.equal(platforms["linux-x86_64-deb"].signature, "deb-sig");
      assert.equal(platforms["linux-aarch64-deb"].signature, "arm-deb-sig");
      assert.equal(
        platforms["linux-x86_64"].url,
        "https://download.jiaqi.im/inkpoint/desktop/0.21.0/Inkpoint_0.21.0_amd64.AppImage",
      );
      assert.equal(platforms["linux-aarch64"].signature, "arm-appimage-sig");
    });
  });

  it("trims signatures and keeps the macOS updater url stable", () => {
    withArtifacts(RELEASE_ARTIFACTS, (dir) => {
      const { platforms } = manifestFor(dir);
      assert.equal(platforms["darwin-aarch64"].signature, "mac-sig");
      assert.equal(
        platforms["darwin-aarch64"].url,
        "https://download.jiaqi.im/inkpoint/desktop/0.21.0/Inkpoint.app.tar.gz",
      );
    });
  });

  it("builds the tap manifest from GitHub release urls so it survives an R2 outage", () => {
    withArtifacts(RELEASE_ARTIFACTS, (dir) => {
      const { platforms } = manifestFor(
        dir,
        tapUrlFor("wmasfoe/homebrew-tap", "md-editor-v0.21.0"),
      );
      assert.equal(
        platforms["windows-x86_64"].url,
        "https://github.com/wmasfoe/homebrew-tap/releases/download/md-editor-v0.21.0/Inkpoint_0.21.0_x64-setup.exe",
      );
    });
  });
});

describe("resolveUpdaterArtifacts", () => {
  it("把 Tauri v2 的 NSIS 安装器本体识别为 Windows 更新产物", () => {
    // 回归：此前只匹配 `.nsis.zip`，Windows 构建实际只产出 `<...>_x64-setup.exe` + `.sig`。
    withArtifacts(
      {
        "Inkpoint_0.13.2_x64-setup.exe": "installer-bytes",
        "Inkpoint_0.13.2_x64-setup.exe.sig": "win-signature",
      },
      (dir) => {
        const [windows] = resolveUpdaterArtifacts(dir);
        assert.equal(windows.name, "Inkpoint_0.13.2_x64-setup.exe");
        assert.equal(windows.signature, "win-signature");
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
        const [windows] = resolveUpdaterArtifacts(dir);
        assert.ok(windows.name.endsWith(".nsis.zip"));
        assert.equal(windows.signature, "zip-signature");
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
        assert.deepEqual(resolveUpdaterArtifacts(dir), []);
      },
    );
  });

  it("skips platforms whose signature is missing", () => {
    // 没有签名的条目会让客户端签名校验失败，宁可缺席。
    withArtifacts(
      {
        "Inkpoint_0.21.0_amd64.AppImage": "appimage",
        "Inkpoint_0.21.0_amd64.deb": "deb",
        "Inkpoint_0.21.0_amd64.deb.sig": "deb-sig",
      },
      (dir) => {
        const keys = resolveUpdaterArtifacts(dir).flatMap((artifact) => artifact.keys);
        assert.deepEqual(keys, ["linux-x86_64-deb"]);
      },
    );
  });

  it("separates Intel and Apple Silicon macOS updater archives", () => {
    withArtifacts(
      {
        "arm/Inkpoint.app.tar.gz": "arm",
        "arm/Inkpoint.app.tar.gz.sig": "arm-sig",
        "intel/Inkpoint_x64.app.tar.gz": "intel",
        "intel/Inkpoint_x64.app.tar.gz.sig": "intel-sig",
      },
      (dir) => {
        const byKey = Object.fromEntries(
          resolveUpdaterArtifacts(dir).map((artifact) => [artifact.keys[0], artifact.signature]),
        );
        assert.equal(byKey["darwin-aarch64"], "arm-sig");
        assert.equal(byKey["darwin-x86_64"], "intel-sig");
      },
    );
  });
});
