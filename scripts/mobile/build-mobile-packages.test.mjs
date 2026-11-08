import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs as parseApkArgs, readVersionName } from "./build-android-apk.mjs";
import { parseArgs as parseIpaArgs, readMarketingVersion } from "./build-ios-ipa.mjs";

describe("build-android-apk", () => {
  it("reads versionName from build.gradle.kts", () => {
    const source = `defaultConfig {\n    versionCode = 4\n    versionName = "0.2.1"\n}`;
    assert.equal(readVersionName(source), "0.2.1");
    assert.equal(readVersionName("android {}"), null);
  });

  it("parses flags and rejects a version that is not semver", () => {
    assert.deepEqual(parseApkArgs([]), { sync: true, version: null });
    assert.deepEqual(parseApkArgs(["--no-sync", "--version", "0.3.0"]), {
      sync: false,
      version: "0.3.0",
    });
    // 版本号会拼进输出文件名，路径分隔符必须被拒绝
    assert.throws(() => parseApkArgs(["--version", "../evil"]), /版本号/);
    assert.throws(() => parseApkArgs(["--version"]), /版本号/);
    assert.throws(() => parseApkArgs(["--unknown"]), /未知参数/);
    // pnpm 传入的独立分隔符要被忽略
    assert.deepEqual(parseApkArgs(["--", "--no-sync"]), { sync: false, version: null });
  });
});

describe("build-ios-ipa", () => {
  it("reads MARKETING_VERSION from the Xcode project", () => {
    const source = "\t\t\t\tCURRENT_PROJECT_VERSION = 10;\n\t\t\t\tMARKETING_VERSION = 0.2.1;\n";
    assert.equal(readMarketingVersion(source), "0.2.1");
    assert.equal(readMarketingVersion("// no version"), null);
  });

  it("parses flags and rejects a version that is not semver", () => {
    assert.deepEqual(parseIpaArgs([]), { sync: true, version: null });
    assert.deepEqual(parseIpaArgs(["--no-sync", "--version", "0.3.0-beta.1"]), {
      sync: false,
      version: "0.3.0-beta.1",
    });
    assert.throws(() => parseIpaArgs(["--version", "a/b"]), /版本号/);
    assert.throws(() => parseIpaArgs(["--unknown"]), /未知参数/);
    assert.deepEqual(parseIpaArgs(["--", "--no-sync"]), { sync: false, version: null });
  });
});
