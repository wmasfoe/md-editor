import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

test("fixed-version browser probe records honest outcomes and clean console", () => {
  fs.rmSync("scratch/mermaid-visual-editing-p0/results", { recursive: true, force: true });
  const run = spawnSync(process.execPath, ["scripts/mermaid-p0/runner.mjs"], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(
    fs.readFileSync("scratch/mermaid-visual-editing-p0/results/results.json", "utf8"),
  );
  assert.deepEqual(
    [report.versions.core, report.versions.dom, report.versions.mermaid],
    ["1.1.3", "1.1.3", "11.17.2"],
  );
  assert.deepEqual([report.versions.playwright, report.versions.vite], ["1.61.1", "6.4.3"]);
  assert.ok(
    report.results.every((result) =>
      ["PASS", "FAIL", "UNSUPPORTED", "NOT RUN"].includes(result.status),
    ),
  );
  assert.ok(report.results.some((result) => result.id === "flowchart-real-mouse-drag-connect"));
  assert.ok(report.results.some((result) => result.id === "sequence-label-edit-source-patch"));
  const findResult = (id) => report.results.find((entry) => entry.id === id);
  assert.equal(findResult("flowchart-label-edit-source-patch").status, "PASS");
  assert.equal(
    findResult("flowchart-label-edit-source-patch").detail.after,
    findResult("flowchart-label-edit-source-patch").detail.expected,
  );
  assert.equal(findResult("flowchart-real-mouse-drag-connect").status, "PASS");
  assert.deepEqual(findResult("flowchart-real-mouse-drag-connect").detail.newEdgeIds.length, 1);
  assert.match(findResult("flowchart-real-mouse-drag-connect").detail.newEdgeIds[0], /^edge:A->C#/);
  assert.equal(findResult("sequence-label-edit-source-patch").status, "PASS");
  assert.equal(
    findResult("sequence-label-edit-source-patch").detail.after,
    findResult("sequence-label-edit-source-patch").detail.expected,
  );
  assert.equal(findResult("manual-display-layout-api").status, "UNSUPPORTED");
  assert.equal(findResult("empty-diagram-creation-gesture").status, "NOT RUN");
  assert.deepEqual(report.consoleErrors, []);
  assert.ok(report.results.every((result) => result.status !== "FAIL"));
  assert.ok(fs.statSync("scratch/mermaid-visual-editing-p0/results/browser.png").size > 0);
  const layoutEvidence = JSON.parse(
    fs.readFileSync("scratch/mermaid-visual-editing-p0/results/layout-api-evidence.json", "utf8"),
  );
  assert.ok(layoutEvidence.flowchartOperations.source.includes("type: 'addNode'"));
  assert.ok(layoutEvidence.sequenceMoveImplementation.source.includes("case 'seq.moveEvent':"));
});
