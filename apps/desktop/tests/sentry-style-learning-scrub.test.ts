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

  it("keeps numbers, versions and ordinary text intact", () => {
    expect(scrubPaths({ message: "比例 12/34，版本 1.2.3 保持稳定" }).message).toBe(
      "比例 12/34，版本 1.2.3 保持稳定",
    );
  });

  it("matches the real Rust sample errors and strips their paths", () => {
    for (const message of [
      "该文件不能作为风格样本：diary/private.md",
      "读取样本失败：/Users/me/notes/diary/private.md 不存在",
      "读取样本失败：C:\\Users\\me\\notes\\a.md 不存在",
    ]) {
      const scrubbed = scrubPaths({ message });
      expect(scrubbed.message).not.toContain("private.md");
      expect(scrubbed.message).not.toContain("a.md");
      expect(isStyleLearningEvent({ message })).toBe(true);
    }
  });
});

describe("O-3: CJK paths and engine failures", () => {
  it("strips Chinese file paths and bare Chinese file names", () => {
    expect(scrubPaths({ message: "该文件不能作为风格样本：日记/2024/私人.md" }).message).toBe(
      "该文件不能作为风格样本：[path]",
    );
    expect(scrubPaths({ message: "该文件不能作为风格样本：客户合同.md" }).message).toBe(
      "该文件不能作为风格样本：[file]",
    );
  });
});

describe("O-3: uppercase extensions and spaced names", () => {
  it("strips uppercase extensions and file names containing spaces", () => {
    expect(scrubPaths({ message: "该文件不能作为风格样本：合同.MD" }).message).toBe(
      "该文件不能作为风格样本：[file]",
    );
    expect(scrubPaths({ message: "该文件不能作为风格样本：我的 笔记.md" }).message).toBe(
      "该文件不能作为风格样本：[file]",
    );
    expect(scrubPaths({ message: "读取样本失败：客户 合同/2024.md 不存在" }).message).toBe(
      "读取样本失败：[path] 不存在",
    );
  });
});

describe("O-3: spaced directory names", () => {
  it("strips paths whose folders contain spaces", () => {
    expect(scrubPaths({ message: "该文件不能作为风格样本：客户A/我的 笔记.md" }).message).toBe(
      "该文件不能作为风格样本：[path]",
    );
    expect(
      scrubPaths({ message: "读取样本失败：/Users/me/我的 笔记/秘密.md 不存在" }).message,
    ).toBe("读取样本失败：[path] 不存在");
  });
});

describe("O-3: whitespace handling", () => {
  it("joins spaced segments but never merges across a newline", () => {
    expect(scrubPaths({ message: "该文件不能作为风格样本：我的\t笔记.md" }).message).toBe(
      "该文件不能作为风格样本：[file]",
    );
    const text = "读取失败: notes.md\n接下来是普通说明文字 以及更多内容.txt";
    expect(scrubPaths({ message: text }).message).toContain("接下来是普通说明文字");
  });
});
