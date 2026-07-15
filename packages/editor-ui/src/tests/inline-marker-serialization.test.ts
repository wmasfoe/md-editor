import { describe, expect, it } from "vitest";
import {
  createRawInlineMarkerTextHandler,
  DISABLED_MICROMARK_CONSTRUCTS,
} from "../components/MilkdownEditor/inlineMarkerPreset";

/**
 * T6 — 序列化保真验证（identity 往返）
 *
 * 直接测试 createRawInlineMarkerTextHandler 的逻辑：
 * - 4 个语法字符（* _ ` ~）不被转义
 * - 结构字符（# > [ 等）仍保留在 unsafe 表中
 * - handler 调用后 state.unsafe 恢复原始值
 */

type UnsafePattern = {
  character?: string;
  inConstruct?: string;
  atBreak?: boolean;
};

type MockState = {
  unsafe: UnsafePattern[];
  safe: (value: string, info: unknown) => string;
};

function makeMockState(patterns: UnsafePattern[]): MockState {
  return {
    unsafe: [...patterns],
    safe(value: string, _info: unknown) {
      let result = value;
      for (const pattern of this.unsafe) {
        if (pattern.character) {
          result = result.replace(
            new RegExp(`\\${pattern.character}`, "g"),
            `\\${pattern.character}`,
          );
        }
      }
      return result;
    },
  };
}

// 真实 unsafe 条目（对应 mdast-util-to-markdown/lib/unsafe.js）
const REAL_UNSAFE_PATTERNS: UnsafePattern[] = [
  { character: "*", inConstruct: "phrasing" },
  { character: "*", atBreak: true },
  { character: "_", inConstruct: "phrasing" },
  { character: "_", atBreak: true },
  { character: "`", inConstruct: "phrasing" },
  { character: "`", atBreak: true },
  { character: "~", atBreak: true },
  { character: "#", atBreak: true },
  { character: ">", atBreak: true },
  { character: "[", inConstruct: "phrasing" },
];

describe("T6 — serialization identity via raw-emit handler", () => {
  it("T6.1 — ** characters not escaped by handler", () => {
    const handler = createRawInlineMarkerTextHandler();
    const state = makeMockState(REAL_UNSAFE_PATTERNS);
    const result = handler({ value: "**bold**" }, null, state, {});
    expect(result).toBe("**bold**");
    expect(result).not.toContain("\\*");
  });

  it("T6.2 — * characters not escaped by handler", () => {
    const handler = createRawInlineMarkerTextHandler();
    const state = makeMockState(REAL_UNSAFE_PATTERNS);
    const result = handler({ value: "*italic*" }, null, state, {});
    expect(result).toBe("*italic*");
    expect(result).not.toContain("\\*");
  });

  it("T6.3 — backtick characters not escaped by handler", () => {
    const handler = createRawInlineMarkerTextHandler();
    const state = makeMockState(REAL_UNSAFE_PATTERNS);
    const result = handler({ value: "`code`" }, null, state, {});
    expect(result).toBe("`code`");
    expect(result).not.toContain("\\`");
  });

  it("T6.4 — ~ characters not escaped by handler", () => {
    const handler = createRawInlineMarkerTextHandler();
    const state = makeMockState(REAL_UNSAFE_PATTERNS);
    const result = handler({ value: "~~strike~~" }, null, state, {});
    expect(result).toBe("~~strike~~");
    expect(result).not.toContain("\\~");
  });

  it("T6.5 — mixed 4-syntax text passes through unchanged", () => {
    const handler = createRawInlineMarkerTextHandler();
    const state = makeMockState(REAL_UNSAFE_PATTERNS);
    const input = "**bold** *italic* `code` ~~strike~~";
    const result = handler({ value: input }, null, state, {});
    expect(result).toBe(input);
  });

  it("T6.6 — state.unsafe restored after handler call (副作用回归)", () => {
    const handler = createRawInlineMarkerTextHandler();
    const state = makeMockState(REAL_UNSAFE_PATTERNS);
    const unsafeBefore = state.unsafe.map((p) => ({ ...p }));

    handler({ value: "**bold**" }, null, state, {});

    // 调用后 state.unsafe 应与调用前完全一致（长度和内容）
    expect(state.unsafe).toHaveLength(unsafeBefore.length);
    expect(state.unsafe).toEqual(unsafeBefore);

    // 结构字符条目仍在 unsafe 表中
    expect(state.unsafe.some((p) => p.character === "#")).toBe(true);
    expect(state.unsafe.some((p) => p.character === ">")).toBe(true);
    expect(state.unsafe.some((p) => p.character === "[")).toBe(true);
  });

  it("T6.7 — DISABLED_MICROMARK_CONSTRUCTS covers all 4 inline syntaxes", () => {
    expect(DISABLED_MICROMARK_CONSTRUCTS).toContain("attention"); // ** and *
    expect(DISABLED_MICROMARK_CONSTRUCTS).toContain("codeText"); // `
    expect(DISABLED_MICROMARK_CONSTRUCTS).toContain("strikethrough"); // ~~
    expect(DISABLED_MICROMARK_CONSTRUCTS).toHaveLength(3);
  });
});
