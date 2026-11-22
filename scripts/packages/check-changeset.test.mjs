import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateChangesetRequirement, readIgnoredPackages } from "./check-changeset.mjs";

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

/**
 * 一个 changeset 同时列出 ignore 与非 ignore 包 → `changeset version` 必然失败。
 *
 * PR #292 实际踩到：changeset 里写了 `@md-editor/compiler`（在 config.json 的
 * `ignore` 列表里）和 4 个要发版的包，本地校验没拦，合并到 main 后
 * "Version or Publish NPM Packages" 直接红：
 * "Mixed changesets that contain both ignored and not ignored packages are not allowed"。
 */
test("mixed changeset（ignored + released）必须被识别为硬错误", () => {
  const ignoredPackages = new Set(["@md-editor/compiler"]);
  const result = evaluateChangesetRequirement({
    changedFiles: ["packages/editor/src/index.ts", ".changeset/mixed.md"],
    changesetContents: {
      "mixed.md": [
        "---",
        '"@md-editor/editor": minor',
        '"@md-editor/compiler": minor',
        "---",
        "",
      ].join("\n"),
    },
    ignoredPackages,
  });

  assert.deepEqual(result.mixedChangesets, [
    { file: "mixed.md", ignored: ["@md-editor/compiler"], released: ["@md-editor/editor"] },
  ]);
});

test("只含 ignored 包的 changeset 不算 mixed（空发版声明）", () => {
  const ignoredPackages = new Set(["@md-editor/compiler"]);
  const result = evaluateChangesetRequirement({
    changedFiles: [".changeset/ignored-only.md"],
    changesetContents: { "ignored-only.md": '---\n"@md-editor/compiler": patch\n---\n' },
    ignoredPackages,
  });
  assert.deepEqual(result.mixedChangesets, []);
});

test("只含 released 包的 changeset 不算 mixed", () => {
  const ignoredPackages = new Set(["@md-editor/compiler"]);
  const result = evaluateChangesetRequirement({
    changedFiles: [".changeset/ok.md"],
    changesetContents: { "ok.md": '---\n"@md-editor/editor": minor\n---\n' },
    ignoredPackages,
  });
  assert.deepEqual(result.mixedChangesets, []);
});

test("readIgnoredPackages 从 config.json 读出 ignore 列表", () => {
  const ignored = readIgnoredPackages(fileURLToPath(new URL("../..", import.meta.url)));
  assert.ok(ignored.has("@md-editor/compiler"), "compiler 应在 ignore 列表内");
  assert.ok(!ignored.has("@md-editor/editor"), "editor 不应在 ignore 列表内");
});

/**
 * `config.json` 坏掉时必须硬失败，不能静默降级为空集合。
 *
 * 若吞掉解析异常，mixed 校验会悄悄失效（`ignore` 变成空集 ⇒ 什么都算 released），
 * 而 `changeset version` 面对同一个坏文件照样会失败——门禁就先骗了我们一次。
 */
test("readIgnoredPackages 在 config.json 损坏时抛错（不得静默降级）", () => {
  const dir = mkdtempSync(join(tmpdir(), "changeset-config-"));
  try {
    mkdirSync(join(dir, ".changeset"), { recursive: true });
    writeFileSync(join(dir, ".changeset/config.json"), "{ not json");
    assert.throws(() => readIgnoredPackages(dir), /not valid JSON/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readIgnoredPackages 在配置缺失时降级为空集合", () => {
  const dir = mkdtempSync(join(tmpdir(), "changeset-config-"));
  try {
    assert.deepEqual([...readIgnoredPackages(dir)], []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
