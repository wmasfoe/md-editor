import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bumpAndroidVersion, readAndroidVersion, updateAndroidGradle } from "./version-android.mjs";

test("bumpAndroidVersion bumps patch correctly", () => {
  assert.equal(bumpAndroidVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpAndroidVersion("0.2.0", "patch"), "0.2.1");
});

test("bumpAndroidVersion bumps minor correctly", () => {
  assert.equal(bumpAndroidVersion("0.1.1", "minor"), "0.2.0");
  assert.equal(bumpAndroidVersion("1.0.3", "minor"), "1.1.0");
});

test("bumpAndroidVersion bumps major correctly", () => {
  assert.equal(bumpAndroidVersion("0.2.0", "major"), "1.0.0");
});

test("bumpAndroidVersion bumps beta correctly", () => {
  assert.equal(bumpAndroidVersion("0.2.0", "beta"), "0.2.1-beta.1");
});

test("bumpAndroidVersion accepts valid custom semver", () => {
  assert.equal(bumpAndroidVersion("0.1.0", "0.2.5"), "0.2.5");
});

test("bumpAndroidVersion throws on invalid version or bump type", () => {
  assert.throws(() => bumpAndroidVersion("0.1.0", "invalid"), /Expected a semver version/u);
  assert.throws(() => bumpAndroidVersion("invalid-version", "patch"), /Cannot patch bump/u);
});

test("readAndroidVersion and updateAndroidGradle work on gradle file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "android-test-"));
  const tmpGradle = path.join(tmpDir, "build.gradle.kts");
  fs.writeFileSync(
    tmpGradle,
    `android {
    defaultConfig {
        versionCode = 2
        versionName = "0.1.1"
    }
}`,
  );

  const initial = readAndroidVersion(tmpGradle);
  assert.equal(initial.version, "0.1.1");
  assert.equal(initial.versionCode, 2);

  updateAndroidGradle("0.2.0", 3, tmpGradle);

  const updated = readAndroidVersion(tmpGradle);
  assert.equal(updated.version, "0.2.0");
  assert.equal(updated.versionCode, 3);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
