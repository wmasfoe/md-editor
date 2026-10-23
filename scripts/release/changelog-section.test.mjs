import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildReleaseBody,
  extractVersionSection,
  normalizeVersion,
  resolveReleaseNotes,
} from "./changelog-section.mjs";

const SAMPLE = `# Changelog

## 0.16.0 - 2026-10-30 (#190)

- 新增更新内容弹窗：
  - 检测到新版本时展示本次更新日志
- 修复侧边栏折叠状态丢失。

## 0.15.1 - 2026-10-22 (#182)

- 修复目录锚点跳转。
`;

describe("normalizeVersion", () => {
  it("strips an optional v prefix and trims", () => {
    assert.equal(normalizeVersion(" v0.16.0 "), "0.16.0");
    assert.equal(normalizeVersion("0.16.0"), "0.16.0");
    assert.equal(normalizeVersion(undefined), "");
  });
});

describe("extractVersionSection", () => {
  it("extracts the requested section including its heading", () => {
    const section = extractVersionSection(SAMPLE, "0.16.0");
    assert.ok(section);
    assert.match(section, /^## 0\.16\.0 - 2026-10-30 \(#190\)/u);
    assert.match(section, /新增更新内容弹窗/u);
    assert.doesNotMatch(section, /目录锚点跳转/u);
  });

  it("accepts a v-prefixed version", () => {
    assert.equal(
      extractVersionSection(SAMPLE, "v0.15.1")?.split("\n")[0],
      "## 0.15.1 - 2026-10-22 (#182)",
    );
  });

  it("returns null when the version is missing", () => {
    assert.equal(extractVersionSection(SAMPLE, "9.9.9"), null);
  });

  it("returns null for a section without list items", () => {
    const markdown = "## 0.17.0\n\n暂无内容。\n\n## 0.16.0\n\n- 旧内容\n";
    assert.equal(extractVersionSection(markdown, "0.17.0"), null);
  });

  it("returns the first match when a version repeats", () => {
    const markdown = "## 0.1.0\n\n- 第一次\n\n## 0.1.0\n\n- 第二次\n";
    assert.match(extractVersionSection(markdown, "0.1.0") ?? "", /第一次/u);
  });

  it("handles CRLF input", () => {
    const markdown = "## 0.2.0 - 2026-11-01\r\n\r\n- 修复问题\r\n";
    assert.equal(extractVersionSection(markdown, "0.2.0"), "## 0.2.0 - 2026-11-01\n\n- 修复问题");
  });

  it("returns null for empty or non-string input", () => {
    assert.equal(extractVersionSection("", "0.1.0"), null);
    assert.equal(extractVersionSection(undefined, "0.1.0"), null);
  });
});

describe("buildReleaseBody", () => {
  it("joins Chinese and English sections with a separator", () => {
    assert.equal(
      buildReleaseBody({ zhNotes: "## 1.0.0\n\n- 中文", enNotes: "## 1.0.0\n\n- English" }),
      "## 1.0.0\n\n- 中文\n\n---\n\n## 1.0.0\n\n- English",
    );
  });

  it("falls back to a single language", () => {
    assert.equal(buildReleaseBody({ zhNotes: "中文", enNotes: null }), "中文");
    assert.equal(buildReleaseBody({ zhNotes: null, enNotes: "English" }), "English");
    assert.equal(buildReleaseBody({ zhNotes: null, enNotes: null }), null);
  });
});

describe("resolveReleaseNotes", () => {
  it("uses the Chinese section for manifest notes and keeps English in the body", () => {
    const resolved = resolveReleaseNotes({
      version: "0.16.0",
      zhMarkdown: SAMPLE,
      enMarkdown: "## 0.16.0\n\n- Update notice\n",
    });
    assert.match(resolved.notes ?? "", /新增更新内容弹窗/u);
    assert.match(resolved.body ?? "", /Update notice/u);
  });
});

describe("repository CHANGELOG integration", () => {
  it("extracts the current desktop version section from the real changelog", () => {
    const markdown = readFileSync(
      new URL("../../apps/desktop/CHANGELOG.md", import.meta.url),
      "utf8",
    );
    const version = /^##\s+(\S+)/mu.exec(markdown)?.[1];
    assert.ok(version, "desktop CHANGELOG must contain at least one version section");
    const section = extractVersionSection(markdown, version);
    assert.ok(section, `section for ${version} must contain list items`);
    assert.match(
      section,
      new RegExp(`^##\\s+${version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
    );
  });
});
