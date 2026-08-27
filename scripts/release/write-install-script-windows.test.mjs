import assert from "node:assert/strict";
import test from "node:test";
import { generateWindowsInstallScript } from "./write-install-script-windows.mjs";

test("generateWindowsInstallScript generates PowerShell installer for Windows", () => {
  const script = generateWindowsInstallScript({
    version: "0.4.0",
    winX64Url: "https://example.com/md-editor-setup-x64.exe",
    winX64Sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    winArm64Url: "https://example.com/md-editor-setup-arm64.exe",
    winArm64Sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  });

  assert.ok(script.includes("$AppName = 'Markdown Editor'"));
  assert.ok(script.includes("$Version = '0.4.0'"));
  assert.ok(script.includes("$WinX64Url = 'https://example.com/md-editor-setup-x64.exe'"));
  assert.ok(script.includes("$WinArm64Url = 'https://example.com/md-editor-setup-arm64.exe'"));
  assert.ok(script.includes("$env:PROCESSOR_ARCHITECTURE"));
  assert.ok(script.includes("AMD64"));
  assert.ok(script.includes("ARM64"));
  assert.ok(script.includes("Start-Process"));
  assert.ok(script.includes("/S"));
});

test("generateWindowsInstallScript throws on missing version", () => {
  assert.throws(() => {
    generateWindowsInstallScript({ version: "" });
  }, /Missing required parameter: version/);
});
