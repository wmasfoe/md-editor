import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getPendingPublishPackages, PUBLISHED_PACKAGE_DIRS } from "./publish.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("treats an npm 404 as an unpublished package", () => {
  const packages = getPendingPublishPackages(root, () => {
    throw Object.assign(new Error("not found"), {
      stdout: JSON.stringify({ error: { code: "E404" } }),
    });
  });
  assert.equal(packages.length, PUBLISHED_PACKAGE_DIRS.length);
});

test("fails on registry errors instead of treating them as unpublished", () => {
  assert.throws(
    () =>
      getPendingPublishPackages(root, () => {
        throw new Error("network failure");
      }),
    /Failed to query npm versions/,
  );
});

test("recognizes npm's 404 error in stderr", () => {
  const packages = getPendingPublishPackages(root, () => {
    throw Object.assign(new Error("not found"), { stderr: "npm error code E404\n" });
  });
  assert.equal(packages.length, PUBLISHED_PACKAGE_DIRS.length);
});

test("does not confuse an unrelated error mentioning E404 with a 404", () => {
  assert.throws(
    () =>
      getPendingPublishPackages(root, () => {
        throw Object.assign(new Error("network failure"), {
          stderr: "npm error request failed for E404\n",
        });
      }),
    /Failed to query npm versions/,
  );
});
