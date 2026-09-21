import assert from "node:assert/strict";
import test from "node:test";
import { assertDownloadUrl, assertSha256 } from "./validate-download-url.mjs";

const SHA = "b7b555664d49b9ca8d1438b57981e41edf6139990abbff0ffae386713987f03d";

test("assertDownloadUrl accepts direct file URLs and keeps empty values", () => {
  assert.equal(
    assertDownloadUrl(
      "LINUX_X64_DOWNLOAD_URL",
      "https://download.jiaqi.im/inkpoint/desktop/0.11.0/Inkpoint_0.11.0_amd64.AppImage",
    ),
    "https://download.jiaqi.im/inkpoint/desktop/0.11.0/Inkpoint_0.11.0_amd64.AppImage",
  );
  assert.equal(assertDownloadUrl("LINUX_ARM64_DOWNLOAD_URL", ""), "");
  assert.equal(assertDownloadUrl("LINUX_ARM64_DOWNLOAD_URL", undefined), "");
});

test("assertDownloadUrl rejects URLs truncated to a version directory", () => {
  // 2026-09-21 实际事故：find 少括号 -> 产物未找到 -> URL 变成版本目录
  assert.throws(
    () =>
      assertDownloadUrl(
        "LINUX_X64_DOWNLOAD_URL",
        "https://download.jiaqi.im/inkpoint/desktop/0.11.0/",
      ),
    /缺少文件名/u,
  );
  assert.throws(
    () =>
      assertDownloadUrl(
        "WIN_X64_DOWNLOAD_URL",
        "https://download.jiaqi.im/inkpoint/desktop/0.11.0",
      ),
    /缺少文件名/u,
  );
  assert.throws(() => assertDownloadUrl("DMG_DOWNLOAD_URL", "not-a-url"), /必须是 http\(s\) 直链/u);
});

test("assertSha256 requires a 64-hex digest whenever a URL is present", () => {
  assert.equal(assertSha256("LINUX_X64_SHA256", "https://x/y.AppImage", SHA.toUpperCase()), SHA);
  assert.throws(
    () => assertSha256("LINUX_X64_SHA256", "https://x/y.AppImage", ""),
    /64 位十六进制/u,
  );
  assert.throws(
    () => assertSha256("LINUX_X64_SHA256", "https://x/y.AppImage", "abc"),
    /64 位十六进制/u,
  );
  // 直链缺失时校验和留空是允许的
  assert.equal(assertSha256("LINUX_ARM64_SHA256", "", ""), "");
});
