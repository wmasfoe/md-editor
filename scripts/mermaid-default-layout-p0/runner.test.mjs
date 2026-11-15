import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

test("fixed-version Chromium UI probe verifies Mermaid identity and reference-first edits", () => {
  fs.rmSync("scratch/mermaid-default-layout-p0/results.json", { force: true });
  const run = spawnSync(process.execPath, ["scripts/mermaid-default-layout-p0/runner.mjs"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(
    fs.readFileSync("scratch/mermaid-default-layout-p0/results.json", "utf8"),
  );
  assert.deepEqual(
    [report.versions.core, report.versions.dom, report.versions.mermaid],
    ["1.1.3", "1.1.3", "11.17.2"],
  );
  assert.deepEqual([report.versions.playwright, report.versions.vite], ["1.61.1", "6.4.3"]);
  assert.equal(report.browser, "Playwright Chromium headless");
  const find = (id) => report.results.find((result) => result.id === id);
  for (const id of [
    "flow-duplicate-label-selected-entity-patch",
    "flow-duplicate-relations-have-distinct-identities",
    "flow-selected-edge-label-patch",
    "flow-delete-only-selected-duplicate-relation",
    "flow-referenced-node-delete-disabled-with-reason",
    "flow-last-edge-delete-preserves-unconnected-node",
    "flow-delete-node-after-relation",
    "sequence-exact-duplicate-message-patch",
    "sequence-unaliased-participant-rename-updates-references",
    "sequence-referenced-participant-delete-disabled-with-reason",
    "sequence-noalias-rename-id-collision-rejected",
    "sequence-delete-messages-before-unreferenced-participant",
    "sequence-duplicate-alias-selected-id-patch",
    "patched-existing-diagrams-still-parse",
    "unsafe-and-unsupported-source-falls-back-with-zero-writes",
    "flow-repeated-primary-declaration-explicit-fallback",
    "same-label-noop-does-not-create-source-change",
    "empty-flow-real-ui-creation-and-parse",
    "empty-seq-real-ui-creation-and-parse",
    "browser-console-clean",
  ])
    assert.equal(find(id)?.status, "PASS", `${id}: ${JSON.stringify(find(id)?.detail)}`);
  assert.deepEqual(report.consoleErrors, []);
  assert.ok(fs.statSync("scratch/mermaid-default-layout-p0/browser.png").size > 0);
});

test("original baseline Chromium probe still verifies real drag-connect and built-in edit behavior", () => {
  fs.rmSync("scratch/mermaid-visual-editing-p0/results", { recursive: true, force: true });
  const run = spawnSync(process.execPath, ["scripts/mermaid-p0/runner.mjs"], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(
    fs.readFileSync("scratch/mermaid-visual-editing-p0/results/results.json", "utf8"),
  );
  const find = (id) => report.results.find((result) => result.id === id);
  assert.equal(find("flowchart-real-mouse-drag-connect")?.status, "PASS");
  assert.equal(find("flowchart-label-edit-source-patch")?.status, "PASS");
  assert.equal(find("sequence-label-edit-source-patch")?.status, "PASS");
  assert.deepEqual(report.consoleErrors, []);
});
