import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

test("canvas probe verifies both diagram types with real geometry and persistence", () => {
  const directory = "scratch/mermaid-visual-editing-p0/canvas-results";
  fs.rmSync(directory, { recursive: true, force: true });
  const run = spawnSync(process.execPath, ["scripts/mermaid-p0-canvas/run.mjs"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(fs.readFileSync(`${directory}/results.json`, "utf8"));
  assert.deepEqual(report.consoleErrors, []);
  assert.ok(report.results.every((item) => item.status !== "FAIL"));
  const result = (id) => {
    const entry = report.results.find((item) => item.id === id);
    assert.ok(entry, `Missing result ${id}`);
    return entry;
  };
  for (const id of [
    "flowchart-node-manual-drag-and-edge-attachment",
    "flowchart-save-reopen-source-layout",
    "flowchart-reset-layout-keeps-source",
    "flow-add-node-preserves-existing-manual-positions",
    "sequence-message-endpoints-align-with-lifelines",
    "sequence-reopen-source-order-and-manual-layout",
    "sequence-theme-and-participant-add-preserve-manual-layout",
    "sequence-reset-visible-layout-preserves-source-order",
    "generated-flow-valid-mermaid-11",
    "generated-sequence-valid-mermaid-11",
    "sequence-loop-safe-source-fallback",
    "flow-subgraph-safe-source-fallback",
    "invalid-source-safe-fallback",
    "empty-source-survives-save-reload",
    "malformed-storage-reported-and-preserved",
  ])
    assert.equal(result(id).status, "PASS", id);
  assert.ok(
    Object.keys(
      result("flow-add-node-preserves-existing-manual-positions").detail.positionsBeforeThird,
    ).length > 0,
  );
  assert.match(
    result("empty-sequence-create-participants-and-request-return").detail.source,
    /P2-->>P1: 消息/,
  );
  assert.equal(result("cancel-interaction").status, "NOT RUN");
  assert.equal(result("production-editor-transaction-integration").status, "NOT RUN");
  for (const file of ["flowchart.png", "sequence.png", "sequence-existing.png"])
    assert.ok(fs.statSync(`${directory}/${file}`).size > 0);
});
