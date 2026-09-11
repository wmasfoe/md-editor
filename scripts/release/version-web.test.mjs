import assert from "node:assert/strict";
import test from "node:test";
import { bumpWebVersion } from "./version-web.mjs";

test("bumpWebVersion bumps patch correctly", () => {
  assert.equal(bumpWebVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpWebVersion("1.2.3", "patch"), "1.2.4");
});

test("bumpWebVersion bumps minor correctly", () => {
  assert.equal(bumpWebVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(bumpWebVersion("1.2.3", "minor"), "1.3.0");
});

test("bumpWebVersion bumps major correctly", () => {
  assert.equal(bumpWebVersion("0.1.0", "major"), "1.0.0");
  assert.equal(bumpWebVersion("1.2.3", "major"), "2.0.0");
});

test("bumpWebVersion bumps beta correctly", () => {
  assert.equal(bumpWebVersion("0.1.0", "beta"), "0.1.1-beta.1");
});

test("bumpWebVersion accepts valid custom semver", () => {
  assert.equal(bumpWebVersion("0.1.0", "0.2.5"), "0.2.5");
  assert.equal(bumpWebVersion("0.1.0", "1.0.0-rc.1"), "1.0.0-rc.1");
});

test("bumpWebVersion throws on invalid version or bump type", () => {
  assert.throws(() => bumpWebVersion("0.1.0", "invalid"), /Expected a semver version/u);
  assert.throws(() => bumpWebVersion("invalid-version", "patch"), /Cannot patch bump/u);
});
