import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "./publish-desktop.mjs";

describe("publish-desktop 参数解析", () => {
  it('解析文档中的 `patch --notes "..."` 用法', () => {
    // 回归：`--notes` 分支此前漏了 `index += 1`，notes 文本会被当成位置参数，
    // 报错 `Unexpected argument: <notes>`，导致发版只能走交互模式。
    const options = parseArgs(["patch", "--notes", "修复已知缺陷"]);

    assert.equal(options.kind, "patch");
    assert.equal(options.notes, "修复已知缺陷");
  });

  it("同时解析中英文 notes、PR 编号与 --yes", () => {
    const options = parseArgs([
      "patch",
      "--notes",
      "中文说明",
      "--notes-en",
      "English notes",
      "--pr",
      "159",
      "--yes",
    ]);

    assert.equal(options.kind, "patch");
    assert.equal(options.notes, "中文说明");
    assert.equal(options.notesEn, "English notes");
    assert.equal(options.pr, "159");
    assert.equal(options.yes, true);
  });

  it("支持显式版本号与 --dry-run/--branch", () => {
    const options = parseArgs(["0.13.2", "--dry-run", "--branch", "main"]);

    assert.equal(options.kind, "0.13.2");
    assert.equal(options.dryRun, true);
    assert.equal(options.branch, "main");
  });

  it("--notes 缺少取值时报错而不是静默吞掉", () => {
    assert.throws(() => parseArgs(["patch", "--notes"]), /Expected a value after --notes/u);
    assert.throws(
      () => parseArgs(["patch", "--notes", "--yes"]),
      /Expected a value after --notes/u,
    );
  });

  it("拒绝未识别的多余位置参数", () => {
    assert.throws(() => parseArgs(["patch", "extra"]), /Unexpected argument: extra/u);
  });
});
