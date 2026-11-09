import { describe, expect, it } from "vitest";
import {
  handleBeforeSend,
  isStyleLearningEvent,
  scrubPaths,
} from "../src/app/error-reporting/sentry";

describe("O-3: style-learning events are scrubbed of paths", () => {
  it("recognises style-learning events by tag or message", () => {
    expect(isStyleLearningEvent({ tags: { feature: "style-learning" } })).toBe(true);
    expect(isStyleLearningEvent({ message: "风格学习失败" })).toBe(true);
    expect(isStyleLearningEvent({ message: "unrelated failure" })).toBe(false);
  });

  it("removes absolute paths and file names but keeps the error description", () => {
    const event = {
      message: "读取样本失败：/Users/me/notes/diary/private.md 无法读取",
      exception: { values: [{ value: "style-learning: C:\\Users\\me\\notes\\a.md 不存在" }] },
      tags: { feature: "style-learning" },
    };
    const scrubbed = scrubPaths(event);
    expect(scrubbed.message).toContain("读取样本失败");
    expect(scrubbed.message).not.toContain("/Users/me");
    expect(scrubbed.message).not.toContain("private.md");
    expect(scrubbed.exception.values[0]!.value).not.toContain("a.md");
    expect(scrubbed.exception.values[0]!.value).not.toContain("C:\\Users");
  });

  it("only scrubs style-learning events in beforeSend", () => {
    const style = handleBeforeSend(
      { message: "风格学习失败：/Users/me/notes/a.md", tags: { feature: "style-learning" } },
      { isDev: false, isEnabled: true },
    );
    expect(style?.message).not.toContain("/Users/me");

    const other = handleBeforeSend(
      { message: "保存失败：/Users/me/notes/a.md" },
      { isDev: false, isEnabled: true },
    );
    expect(other?.message).toContain("/Users/me");
  });
});
