import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatPrSuffix, updateChangelogContents, updateChangelogPair } from "./changelog.mjs";

test("formatPrSuffix formats single number or array correctly", () => {
  assert.equal(formatPrSuffix(undefined), "");
  assert.equal(formatPrSuffix(""), "");
  assert.equal(formatPrSuffix(49), " (#49)");
  assert.equal(formatPrSuffix("#49"), " (#49)");
  assert.equal(formatPrSuffix([49]), " (#49)");
  assert.equal(formatPrSuffix([48, 49]), " (#48, #49)");
});

test("normal mode prepends one target-version section with PR", () => {
  const next = updateChangelogContents("# Changelog\n\n## 0.3.16 - 2026-07-09\n\n- Previous.\n", {
    version: "0.3.17",
    notes: "Added website.",
    date: "2026-07-10",
    mode: "normal",
    pr: 49,
  });

  assert.match(next, /^# Changelog\n\n## 0\.3\.17 - 2026-07-10 \(#49\)\n\n- Added website\./u);
});

test("normal mode prepends one target-version section", () => {
  const next = updateChangelogContents("# Changelog\n\n## 0.3.16 - 2026-07-09\n\n- Previous.\n", {
    version: "0.3.17",
    notes: "Added website.\n- Fixed deploy.",
    date: "2026-07-10",
    mode: "normal",
  });

  assert.match(
    next,
    /^# Changelog\n\n## 0\.3\.17 - 2026-07-10\n\n- Added website\.\n- Fixed deploy\./u,
  );
  assert.equal((next.match(/^##\s+0\.3\.17/gmu) ?? []).length, 1);
});

test("normal mode fails when target version already exists", () => {
  assert.throws(
    () =>
      updateChangelogContents("# Changelog\n\n## 0.3.17 - 2026-07-10\n\n- Existing.\n", {
        version: "0.3.17",
        notes: "Duplicate.",
        date: "2026-07-10",
        mode: "normal",
      }),
    /already contains section/u,
  );
});

test("normal mode uses a Chinese note when notes are empty", () => {
  const next = updateChangelogContents("# 更新记录\n\n## 0.3.16 - 2026-07-09\n\n- 旧版本。\n", {
    version: "0.3.17",
    notes: "",
    date: "2026-07-10",
    mode: "normal",
  });

  assert.match(next, /- 暂无发布说明。/u);
});

test("resume mode reuses existing target section unchanged", () => {
  const current = "# Changelog\n\n## 0.3.17 - 2026-07-10\n\n- Existing.\n";
  const next = updateChangelogContents(current, {
    version: "0.3.17",
    notes: "Ignored on resume.",
    date: "2026-07-10",
    mode: "resume",
  });

  assert.equal(next, current);
});

test("resume mode fails without target section", () => {
  assert.throws(
    () =>
      updateChangelogContents("# Changelog\n\n## 0.3.16 - 2026-07-09\n\n- Previous.\n", {
        version: "0.3.17",
        notes: "Missing.",
        date: "2026-07-10",
        mode: "resume",
      }),
    /missing section/u,
  );
});

test("inserts after a platform-suffixed title without duplicating the heading", () => {
  const current =
    "# Changelog - Inkpoint iOS\n\nAll notable changes.\n\n## 0.1.0 - 2026-09-16\n\n- First release.\n";

  const next = updateChangelogContents(current, {
    version: "0.2.1",
    notes: "自签分发链路",
    date: "2026-10-07",
  });

  // 标题只允许出现一次，且新版本条目紧随其后
  assert.equal(next.match(/^#\s+Changelog/gm)?.length, 1);
  assert.match(
    next,
    /^# Changelog - Inkpoint iOS\n\n## 0\.2\.1 - 2026-10-07\n\n- 自签分发链路\n\nAll notable changes\./u,
  );
  assert.ok(next.includes("## 0.1.0 - 2026-09-16"));
});

test("updateChangelogPair writes both ZH and EN entries with EN notes when provided", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-pair-"));
  const zhPath = path.join(dir, "CHANGELOG.md");
  const enPath = path.join(dir, "CHANGELOG_EN.md");
  fs.writeFileSync(zhPath, "# Changelog\n");
  fs.writeFileSync(enPath, "# Changelog\n");

  const result = updateChangelogPair({
    zhPath,
    enPath,
    version: "1.2.3",
    notes: "中文说明",
    notesEn: "English notes",
    date: "2026-01-02",
  });

  assert.equal(result.zh.changed, true);
  assert.equal(result.en.changed, true);
  assert.match(fs.readFileSync(zhPath, "utf8"), /## 1\.2\.3 - 2026-01-02[\s\S]*- 中文说明/u);
  assert.match(fs.readFileSync(enPath, "utf8"), /## 1\.2\.3 - 2026-01-02[\s\S]*- English notes/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("updateChangelogPair falls back to zh notes when notesEn is absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-pair-fallback-"));
  const zhPath = path.join(dir, "CHANGELOG.md");
  const enPath = path.join(dir, "CHANGELOG_EN.md");
  fs.writeFileSync(zhPath, "# Changelog\n");
  fs.writeFileSync(enPath, "# Changelog\n");

  updateChangelogPair({
    zhPath,
    enPath,
    version: "1.2.4",
    notes: "same notes",
    date: "2026-01-03",
  });

  // 关键：两文件首条版本一致（apps/site 的 changelog 解析测试依赖此不变量）
  assert.match(fs.readFileSync(enPath, "utf8"), /## 1\.2\.4 - 2026-01-03/u);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("updateChangelogPair skips EN when the EN file does not exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-pair-missing-"));
  const zhPath = path.join(dir, "CHANGELOG.md");
  fs.writeFileSync(zhPath, "# Changelog\n");

  const result = updateChangelogPair({
    zhPath,
    enPath: path.join(dir, "CHANGELOG_EN.md"),
    version: "1.2.5",
    notes: "zh only",
    date: "2026-01-04",
  });

  assert.equal(result.en, null);
  assert.match(fs.readFileSync(zhPath, "utf8"), /## 1\.2\.5 - 2026-01-04/u);
  fs.rmSync(dir, { recursive: true, force: true });
});
