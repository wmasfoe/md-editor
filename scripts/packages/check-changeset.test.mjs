import assert from "node:assert/strict";
import test from "node:test";
import { evaluateChangesetRequirement } from "./check-changeset.mjs";

test("identifies published package changes requiring a changeset", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ["packages/core/src/state.ts", "apps/desktop/src/app.tsx"],
  });

  assert.equal(result.needsChangeset, true);
  assert.deepEqual(result.touchedPackages, ["@md-editor/core"]);
  assert.equal(result.hasChangeset, false);
});

test("passes when a valid changeset markdown file is in changedFiles", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ["packages/editor/src/index.ts", ".changeset/cyan-lions-dance.md"],
  });

  assert.equal(result.needsChangeset, true);
  assert.deepEqual(result.touchedPackages, ["@md-editor/editor"]);
  assert.equal(result.hasChangeset, true);
  assert.deepEqual(result.activeChangesets, ["cyan-lions-dance.md"]);
});

test("does not treat .changeset/README.md as a valid changeset", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ["packages/editor/src/index.ts", ".changeset/README.md"],
  });

  assert.equal(result.needsChangeset, true);
  assert.equal(result.hasChangeset, false);
  assert.deepEqual(result.activeChangesets, []);
});

test("ignores changes in private packages and apps", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: [
      "packages/ai/src/index.ts",
      "packages/app-ui/src/index.ts",
      "packages/compiler/src/index.ts",
      "apps/desktop/src/main.ts",
      "docs/index.md",
    ],
  });

  assert.equal(result.needsChangeset, false);
  assert.deepEqual(result.touchedPackages, []);
  assert.equal(result.hasChangeset, false);
});

test("handles multiple touched published packages in sorted order", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: [
      "packages/shared/src/utils.ts",
      "packages/plugin-sdk/src/types.ts",
      "packages/markdown-fidelity/src/parse.ts",
      ".changeset/cool-bears-sing.md",
    ],
  });

  assert.equal(result.needsChangeset, true);
  assert.deepEqual(result.touchedPackages, [
    "@md-editor/markdown-fidelity",
    "@md-editor/plugin-sdk",
    "@md-editor/shared",
  ]);
  assert.equal(result.hasChangeset, true);
});
