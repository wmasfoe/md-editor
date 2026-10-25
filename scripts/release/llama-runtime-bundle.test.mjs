import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const tauriDir = fileURLToPath(new URL("../../apps/desktop/src-tauri/", import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(tauriDir, "tauri.macos.conf.json"), "utf8"));

function stageRuntime(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-llama-bundle-"));
  const contents = path.join(directory, "Inkpoint.app", "Contents");
  const binDir = path.join(contents, "MacOS");
  fs.mkdirSync(binDir, { recursive: true });
  t.after(() => {
    fs.chmodSync(binDir, 0o755);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  // Mirror Tauri's custom-file mapping, including directory contents merged into MacOS.
  for (const [destination, source] of Object.entries(config.bundle.macOS.files)) {
    if (destination === "MacOS" || destination.startsWith("MacOS/")) {
      fs.cpSync(path.join(tauriDir, source), path.join(contents, destination), {
        recursive: true,
      });
    }
  }
  const executable = path.join(binDir, "llama-server");
  fs.copyFileSync(path.join(tauriDir, "binaries/llama-server-aarch64-apple-darwin"), executable);
  return { binDir, executable };
}

test("macOS bundle places the complete llama dylib payload beside the sidecar", (t) => {
  const { binDir } = stageRuntime(t);
  const payload = path.join(tauriDir, "binaries/llama-runtime-macos-arm64");
  for (const name of fs.readdirSync(payload).filter((entry) => entry.endsWith(".dylib"))) {
    assert.ok(fs.existsSync(path.join(binDir, name)), `missing bundled dependency: ${name}`);
  }
});

test(
  "hardened macOS sidecar starts from the bundle without DYLD overrides or app writes",
  { skip: process.platform !== "darwin" || process.arch !== "arm64" },
  (t) => {
    const { binDir, executable } = stageRuntime(t);
    const signed = spawnSync("codesign", [
      "--force",
      "--sign",
      "-",
      "--options",
      "runtime",
      "--entitlements",
      path.join(tauriDir, config.bundle.macOS.entitlements),
      executable,
    ]);
    assert.equal(signed.status, 0, signed.stderr.toString());
    // Release signing enables hardened runtime; env-only fixes cannot prove this contract.
    const env = { ...process.env };
    for (const name of Object.keys(env).filter((entry) => entry.startsWith("DYLD_"))) {
      delete env[name];
    }
    fs.chmodSync(binDir, 0o555);
    const result = spawnSync(executable, ["--version"], {
      cwd: os.tmpdir(),
      env,
      timeout: 30_000,
      encoding: "utf8",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /version:/u);
  },
);
