import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DOMAINS,
  PURGE_PATHS,
  purgeCloudflareZoneCache,
  purgeWorkerCache,
  resolvePurgeUrls,
} from "./purge-download-cache.mjs";

describe("purge-download-cache", () => {
  it("exports default domains and paths", () => {
    assert.ok(DEFAULT_DOMAINS.length >= 2);
    assert.ok(PURGE_PATHS.includes("/api/inkpoint/version.json"));
  });

  it("resolves unique purge URLs across domains", () => {
    const urls = resolvePurgeUrls(
      ["https://example.com"],
      ["", "/", "/inkpoint", "/api/version.json"],
    );
    assert.deepEqual(urls, [
      "https://example.com",
      "https://example.com/",
      "https://example.com/inkpoint",
      "https://example.com/api/version.json",
    ]);
  });

  it("handles trailing slashes on domain names gracefully", () => {
    const urls = resolvePurgeUrls(["https://example.com///"], ["/test"]);
    assert.deepEqual(urls, ["https://example.com/test"]);
  });

  it("gracefully handles network errors in purgeWorkerCache without throwing", async () => {
    const result = await purgeWorkerCache(
      "http://127.0.0.1:99999",
      ["http://127.0.0.1:99999/test"],
      "token",
    );
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it("gracefully handles network errors in purgeCloudflareZoneCache without throwing", async () => {
    const result = await purgeCloudflareZoneCache("fake-zone", "fake-token", [
      "https://example.com/",
    ]);
    assert.equal(result.success, false);
    assert.ok(result.error || result.errors);
  });
});
