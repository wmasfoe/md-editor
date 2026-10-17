import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "./publish-web.mjs";

describe("publish-web 参数解析", () => {
  it('解析文档中的 `patch --notes "..."` 用法', () => {
    // 回归：`--notes` 分支此前漏了 `index += 1`，notes 文本会被当成位置参数报
    // `Unexpected argument: <notes>`，Web 发版只能走交互模式。
    const options = parseArgs(["patch", "--notes", "上线 CJK 修复"]);

    assert.equal(options.kind, "patch");
    assert.equal(options.notes, "上线 CJK 修复");
  });

  it("同时解析中英文 notes、PR、--deploy 与 --yes", () => {
    const options = parseArgs([
      "patch",
      "--notes",
      "中文说明",
      "--notes-en",
      "English notes",
      "--pr",
      "159",
      "--deploy",
      "--yes",
    ]);

    assert.equal(options.notes, "中文说明");
    assert.equal(options.notesEn, "English notes");
    assert.equal(options.pr, "159");
    assert.equal(options.deploy, true);
    assert.equal(options.yes, true);
  });

  it("--no-deploy 优先于 --deploy（后写的生效）", () => {
    assert.equal(parseArgs(["patch", "--deploy", "--no-deploy"]).deploy, false);
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
