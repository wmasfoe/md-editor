import assert from "node:assert/strict";
import test from "node:test";
import { updateChangelogContents } from "./changelog.mjs";

test("normal mode prepends one target-version section", () => {
  const next = updateChangelogContents("# Changelog\n\n## 0.3.16 - 2026-07-09\n\n- Previous.\n", {
    version: "0.3.17",
    notes: "Added website.\n- Fixed deploy.",
    date: "2026-07-10",
    mode: "normal"
  });

  assert.match(next, /^# Changelog\n\n## 0\.3\.17 - 2026-07-10\n\n- Added website\.\n- Fixed deploy\./u);
  assert.equal((next.match(/^##\s+0\.3\.17/mgu) ?? []).length, 1);
});

test("normal mode fails when target version already exists", () => {
  assert.throws(
    () =>
      updateChangelogContents("# Changelog\n\n## 0.3.17 - 2026-07-10\n\n- Existing.\n", {
        version: "0.3.17",
        notes: "Duplicate.",
        date: "2026-07-10",
        mode: "normal"
      }),
    /already contains section/u
  );
});

test("normal mode uses a Chinese note when notes are empty", () => {
  const next = updateChangelogContents("# 更新记录\n\n## 0.3.16 - 2026-07-09\n\n- 旧版本。\n", {
    version: "0.3.17",
    notes: "",
    date: "2026-07-10",
    mode: "normal"
  });

  assert.match(next, /- 暂无发布说明。/u);
});

test("resume mode reuses existing target section unchanged", () => {
  const current = "# Changelog\n\n## 0.3.17 - 2026-07-10\n\n- Existing.\n";
  const next = updateChangelogContents(current, {
    version: "0.3.17",
    notes: "Ignored on resume.",
    date: "2026-07-10",
    mode: "resume"
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
        mode: "resume"
      }),
    /missing section/u
  );
});
