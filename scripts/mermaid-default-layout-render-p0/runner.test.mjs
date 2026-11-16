import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

test("renderer probe records theme evidence and verifies the pinned lifecycle patch", () => {
  const run = spawnSync(process.execPath, ["scripts/mermaid-default-layout-render-p0/runner.mjs"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(
    fs.readFileSync("scratch/mermaid-default-layout-render-p0/results/results.json", "utf8"),
  );
  const byId = Object.fromEntries(report.results.map((result) => [result.id, result]));
  assert.deepEqual(
    [report.versions.core, report.versions.dom, report.versions.mermaid],
    ["1.1.3", "1.1.3", "11.17.2"],
  );
  assert.equal(byId["raw-concurrent-themes-match-serial-reference"].status, "FAIL");
  assert.equal(
    byId["raw-concurrent-themes-match-serial-reference"].detail.concurrent[1].actorFill,
    "rgb(248, 233, 176)",
  );
  assert.equal(byId["theme-isolation-assertion-rejects-collapsed-theme"].status, "PASS");
  assert.deepEqual(
    byId["serialized-facade-isolates-per-view-theme"].detail.map(
      ({ kind, theme, nodeFill, actorFill }) =>
        kind === "flow" ? [kind, theme, nodeFill] : [kind, theme, actorFill],
    ),
    [
      ["flow", "light", "rgb(236, 236, 255)"],
      ["sequence", "dark", "rgb(36, 54, 75)"],
      ["flow", "dark", "rgb(31, 32, 32)"],
      ["sequence", "light", "rgb(248, 233, 176)"],
    ],
  );
  assert.equal(byId["serialized-facade-isolates-per-view-theme"].status, "PASS");
  assert.equal(byId["rapid-same-view-theme-switch-keeps-latest-theme"].status, "PASS");
  assert.equal(byId["facade-forces-strict-for-scriptable-link"].status, "PASS");
  assert.equal(byId["serialized-parse-error-does-not-poison-next-renderer-use"].status, "PASS");
  assert.equal(byId["invalid-render-then-valid-multiview-recovers"].status, "PASS");
  assert.equal(byId["twenty-open-render-destroy-cycles"].status, "PASS");
  assert.equal(byId["patched-view-invalidates-pending-render-and-validation"].status, "PASS");
  assert.equal(byId["upstream-view-control-reproduces-late-detached-write"].status, "FAIL");
  assert.equal(byId["pinned-upstream-lifecycle-patch"].status, "PASS");
  assert.equal(
    byId["pinned-upstream-lifecycle-patch"].detail.upstreamSha256,
    "19e36af849b528373fca55f30675a6300d3596abe3f00719ff33ab150b637f9c",
  );
  assert.ok(
    fs
      .readFileSync(
        "scripts/mermaid-default-layout-render-p0/visimer-dom-1.1.3-lifecycle.patch",
        "utf8",
      )
      .includes("this.renderSeq++"),
  );
  assert.deepEqual(report.consoleErrors, []);
});
