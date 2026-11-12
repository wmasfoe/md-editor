import assert from "node:assert/strict";
import test from "node:test";
import { getPendingPublishPackages } from "./publish.mjs";

const root = new URL("../..", import.meta.url).pathname;

test("treats an npm 404 as an unpublished package", () => {
  const packages = getPendingPublishPackages(root, () => {
    throw Object.assign(new Error("not found"), {
      stdout: JSON.stringify({ error: { code: "E404" } }),
    });
  });
  assert.equal(packages.length, 6);
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
