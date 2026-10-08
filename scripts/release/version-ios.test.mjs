import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDynamicBundleVersion,
  bumpIosVersion,
  iosAppInfoPlistPath,
  readIosVersion,
  updateIosProject,
} from "./version-ios.mjs";

test("bumpIosVersion bumps patch/minor/major/beta correctly", () => {
  assert.equal(bumpIosVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpIosVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(bumpIosVersion("0.2.1", "major"), "1.0.0");
  assert.equal(bumpIosVersion("0.2.1", "beta"), "0.2.2-beta.1");
  assert.equal(bumpIosVersion("0.2.1", "0.3.0"), "0.3.0");
});

test("updateIosProject updates every build configuration, not just the first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-ios-"));
  const projectPath = path.join(dir, "project.pbxproj");
  fs.writeFileSync(
    projectPath,
    [
      "			CURRENT_PROJECT_VERSION = 8;",
      "			MARKETING_VERSION = 0.1.0;",
      "			CURRENT_PROJECT_VERSION = 8;",
      "			MARKETING_VERSION = 0.1.0;",
    ].join("\n"),
  );

  updateIosProject("0.2.2", 10, projectPath);
  const updated = fs.readFileSync(projectPath, "utf8");
  assert.equal(updated.match(/MARKETING_VERSION = 0\.2\.2;/gu)?.length, 2);
  assert.equal(updated.match(/CURRENT_PROJECT_VERSION = 10;/gu)?.length, 2);

  const readBack = readIosVersion(projectPath);
  assert.equal(readBack.version, "0.2.2");
  assert.equal(readBack.buildNumber, 10);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("assertDynamicBundleVersion rejects a hardcoded version in Info.plist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkpoint-plist-"));
  const plistPath = path.join(dir, "Info.plist");
  fs.writeFileSync(
    plistPath,
    [
      "<key>CFBundleShortVersionString</key>",
      "<string>0.1.0</string>",
      "<key>CFBundleVersion</key>",
      "<string>$(CURRENT_PROJECT_VERSION)</string>",
    ].join("\n"),
  );

  assert.throws(() => assertDynamicBundleVersion(plistPath), /CFBundleShortVersionString/u);

  fs.writeFileSync(
    plistPath,
    [
      "<key>CFBundleShortVersionString</key>",
      "<string>$(MARKETING_VERSION)</string>",
      "<key>CFBundleVersion</key>",
      "<string>$(CURRENT_PROJECT_VERSION)</string>",
    ].join("\n"),
  );
  assert.doesNotThrow(() => assertDynamicBundleVersion(plistPath));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("repository iOS Info.plist keeps bundle versions dynamic", () => {
  // 包内版本号必须跟随 MARKETING_VERSION：写死会导致「官网 0.2.x、包内 0.1.0」
  assert.ok(fs.existsSync(iosAppInfoPlistPath), "iOS 工程应存在 App 的 Info.plist");
  assert.doesNotThrow(() => assertDynamicBundleVersion());
});
