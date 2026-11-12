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
    changesetContents: {
      "cyan-lions-dance.md": '---\n"@md-editor/editor": patch\n---\nFix editor.\n',
    },
  });

  assert.equal(result.needsChangeset, true);
  assert.deepEqual(result.touchedPackages, ["@md-editor/editor"]);
  assert.equal(result.hasChangeset, true);
  assert.deepEqual(result.missingPackages, []);
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

test("reports every package not covered by valid changeset frontmatter", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: [
      "packages/core/src/index.ts",
      "packages/editor/src/index.ts",
      ".changeset/fix.md",
    ],
    changesetContents: {
      "fix.md": '---\n"@md-editor/core": patch\n"@md-editor/editor": invalid\n---\nFix.\n',
    },
  });
  assert.deepEqual(result.missingPackages, ["@md-editor/editor"]);
});

test("does not count deleted changesets or mentions outside frontmatter", () => {
  const result = evaluateChangesetRequirement({
    changedFiles: ["packages/core/src/index.ts", ".changeset/deleted.md", ".changeset/other.md"],
    changesetContents: {
      "other.md": '---\n"@md-editor/editor": patch\n---\n"@md-editor/core": patch\n',
    },
  });
  assert.deepEqual(result.missingPackages, ["@md-editor/core"]);
});

test("accepts an explicit empty changeset as a no-release decision", () => {
  for (const content of ["---\n---\n", "---\n\n---\n\n", "---\r\n---\r\nNo release.\r\n"]) {
    const result = evaluateChangesetRequirement({
      changedFiles: ["packages/core/tests/state.test.ts", ".changeset/empty.md"],
      changesetContents: { "empty.md": content },
    });
    assert.equal(result.noRelease, true);
    assert.deepEqual(result.missingPackages, []);
  }
});

test("does not treat malformed or deleted changesets as an opt-out", () => {
  for (const content of ["", "---\ninvalid\n---\n", "---\n---not-frontmatter\n"]) {
    const result = evaluateChangesetRequirement({
      changedFiles: ["packages/core/src/index.ts", ".changeset/empty.md"],
      changesetContents: { "empty.md": content },
    });
    assert.equal(result.noRelease, false);
    assert.deepEqual(result.missingPackages, ["@md-editor/core"]);
  }
});
