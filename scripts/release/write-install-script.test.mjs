import assert from "node:assert/strict";
import test from "node:test";
import { generateInstallScript } from "./write-install-script.mjs";

test("generateInstallScript generates shell script supporting macOS and Linux", () => {
  const script = generateInstallScript({
    version: "0.4.0",
    dmgUrl: "https://example.com/md-editor.dmg",
    dmgSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    linuxX64Url: "https://example.com/md-editor-x86_64.AppImage",
    linuxX64Sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    linuxArm64Url: "https://example.com/md-editor-aarch64.AppImage",
    linuxArm64Sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  });

  assert.ok(script.startsWith("#!/bin/sh"));
  assert.ok(script.includes("VERSION='0.4.0'"));
  assert.ok(script.includes("DMG_URL='https://example.com/md-editor.dmg'"));
  assert.ok(script.includes("LINUX_X64_URL='https://example.com/md-editor-x86_64.AppImage'"));
  assert.ok(script.includes("LINUX_ARM64_URL='https://example.com/md-editor-aarch64.AppImage'"));
  assert.ok(script.includes("install_macos"));
  assert.ok(script.includes("install_linux"));
  assert.ok(script.includes("Darwin)"));
  assert.ok(script.includes("Linux)"));
  assert.ok(script.includes("x86_64|amd64)"));
  assert.ok(script.includes("aarch64|arm64)"));
  assert.ok(script.includes(".desktop"));
});

test("generateInstallScript throws on missing version", () => {
  assert.throws(() => {
    generateInstallScript({ version: "" });
  }, /Missing required parameter: version/);
});
