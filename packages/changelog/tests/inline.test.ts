import { describe, expect, it } from "vitest";
import { tokenizeInlineMarkdown } from "../src/index.ts";

describe("tokenizeInlineMarkdown", () => {
  it("returns a single text token for plain text", () => {
    expect(tokenizeInlineMarkdown("修复标题锚点跳转")).toEqual([
      { kind: "text", text: "修复标题锚点跳转" },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(tokenizeInlineMarkdown("")).toEqual([]);
  });

  it("tokenizes inline code, bold and https link", () => {
    expect(
      tokenizeInlineMarkdown("支持 `**` 与 **粗体**，见 [官网](https://editor.jiaqi.im)。"),
    ).toEqual([
      { kind: "text", text: "支持 " },
      { kind: "code", text: "**" },
      { kind: "text", text: " 与 " },
      { kind: "bold", text: "粗体" },
      { kind: "text", text: "，见 " },
      { kind: "link", text: "官网", href: "https://editor.jiaqi.im" },
      { kind: "text", text: "。" },
    ]);
  });

  it("keeps non-https links as plain text instead of link tokens", () => {
    const tokens = tokenizeInlineMarkdown("[危险](javascript:alert(1)) [数据](data:text/html,x)");
    expect(tokens.some((token) => token.kind === "link")).toBe(false);
    expect(tokens).toEqual([
      { kind: "text", text: "[危险](javascript:alert(1)) [数据](data:text/html,x)" },
    ]);
  });

  it("keeps unclosed markers as plain text", () => {
    expect(tokenizeInlineMarkdown("**未闭合 与 `代码")).toEqual([
      { kind: "text", text: "**未闭合 与 `代码" },
    ]);
  });

  it("gives inline code priority over bold inside it", () => {
    expect(tokenizeInlineMarkdown("`**不是粗体**`")).toEqual([
      { kind: "code", text: "**不是粗体**" },
    ]);
  });
});
