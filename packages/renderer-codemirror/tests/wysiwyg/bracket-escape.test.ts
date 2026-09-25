import { describe, expect, it } from "vitest";
import {
  detectBracketUnit,
  detectBracketUnitInCell,
  detectBracketUnitInLineRuns,
} from "../../src/wysiwyg/bracket-escape.ts";

/**
 * U-ESC —— `detectBracketUnit(text, offset)` 纯函数的单元测试（test-spec §1）。
 *
 * 用 `|` 标记光标位置的写法构造入参，便于逐条对应 deep-interview 确认的行为契约。
 */
function at(text: string): { text: string; offset: number } {
  const offset = text.indexOf("|");
  if (offset === -1) {
    throw new Error("fixture 缺少光标标记 |");
  }
  return { text: text.slice(0, offset) + text.slice(offset + 1), offset };
}

describe("U-ESC 三态（deep-interview 逐态确认的统一规则）", () => {
  it("U1a foo(|) → foo()|", () => {
    const { text, offset } = at("foo(|)");
    expect(detectBracketUnit(text, offset)).toEqual({ kind: "bracket", from: 3, to: 5 });
  });

  it("U1b foo|() → foo()|", () => {
    const { text, offset } = at("foo|()");
    expect(detectBracketUnit(text, offset)).toEqual({ kind: "bracket", from: 3, to: 5 });
  });

  it("U1c foo()| → 不动（规则的不动点）", () => {
    const { text, offset } = at("foo()|");
    expect(detectBracketUnit(text, offset)).toBeNull();
  });

  it("U2 foo(xxx|xxx) → 非空对也跳，且函数零文本变更", () => {
    const { text, offset } = at("foo(xxx|xxx)");
    const unit = detectBracketUnit(text, offset);
    expect(unit).toEqual({ kind: "bracket", from: 3, to: 11 });
    // 纯函数只返回坐标，绝不改写文本 —— 这是 T20「零文本变更」的类型级保证
    expect(text).toBe("foo(xxxxxx)");
  });

  it("U3 foo(bar(baz|)qux) → 取最内层", () => {
    const { text, offset } = at("foo(bar(baz|)qux)");
    const unit = detectBracketUnit(text, offset);
    // 最内层是 (baz) = [7,12)，故 to = 12
    expect(unit).toEqual({ kind: "bracket", from: 7, to: 12 });
  });
});

describe("U-ESC fail closed 边界", () => {
  it("U4 foo(bar(baz| 不平衡 → null（绝不飞到行尾/文末）", () => {
    const { text, offset } = at("foo(bar(baz|");
    expect(detectBracketUnit(text, offset)).toBeNull();
  });

  it("U5 \\( 转义括号不配对", () => {
    const { text, offset } = at("\\(|");
    expect(detectBracketUnit(text, offset)).toBeNull();
    const second = at("\\(x\\|)");
    expect(detectBracketUnit(second.text, second.offset)).toBeNull();
  });

  it("U10 行内代码内的括号不配对（适配器 fail closed）", () => {
    const { text, offset } = at("`f(x|)`");
    expect(detectBracketUnit(text, offset)).toBeNull();
  });
});

describe("U-ESC link / 图片当整体单元", () => {
  it("T9 [文本|](url) → 跳到整条链接右边界", () => {
    const { text, offset } = at("[文本|](./x.md)");
    const unit = detectBracketUnit(text, offset);
    expect(unit?.kind).toBe("link");
    expect(unit?.to).toBe(text.length);
  });

  it("T10 ![alt|](src) → 跳到整条图片右边界", () => {
    const { text, offset } = at("![alt|](./a.png)");
    const unit = detectBracketUnit(text, offset);
    expect(unit?.kind).toBe("link");
    expect(unit?.to).toBe(text.length);
  });

  it("[文本](url)| → 已在右边界，不动", () => {
    const { text, offset } = at("[文本](./x.md)|");
    expect(detectBracketUnit(text, offset)).toBeNull();
  });

  it("U9 链接 title 内的括号不参与配对（link 是独立语义 run）", () => {
    // 光标落在 link span 内 → 必须返回 **link 整体单元**，
    // 而不是把 title 里的 `(x)` 当成可跳出的括号对。
    const { text, offset } = at('[a](b "title (x|)")');
    const unit = detectBracketUnit(text, offset);
    expect(unit?.kind, "title 里的 (x) 不得成为跳出目标").toBe("link");
    expect(unit?.to).toBe(text.length);

    // 变体：光标刚过 `(x)` 的右括号（内层对的右边界不动点）→ 仍归 link 整体
    const variant = at('[a](b "title (x)|")');
    const variantUnit = detectBracketUnit(variant.text, variant.offset);
    expect(variantUnit?.kind).toBe("link");
    expect(variantUnit?.to).toBe(variant.text.length);
  });
});

describe("U-ESC CJK 括号", () => {
  it("「|」 → 跳出全角引号", () => {
    const { text, offset } = at("「|」");
    expect(detectBracketUnit(text, offset)).toEqual({ kind: "bracket", from: 0, to: 2 });
  });

  it("（see (Smith| 2020)） 嵌套取最内层半角对", () => {
    const { text, offset } = at("（see (Smith| 2020)）");
    const unit = detectBracketUnit(text, offset);
    expect(unit?.from).toBe(text.indexOf("("));
    expect(unit?.kind).toBe("bracket");
  });
});

describe("U10 单元格适配器（语义与 CM6 路径单一）", () => {
  it("cell 内括号照跳", () => {
    const { text, offset } = at("值 (x|) 尾");
    expect(detectBracketUnitInCell(text, offset)).toEqual({
      kind: "bracket",
      from: text.indexOf("("),
      to: text.indexOf(")") + 1,
    });
  });

  it("cell 内 link 当整体（不复用 link-projection range，自带小解析器）", () => {
    const { text, offset } = at("见 [架构|设计](./a.md) 结束");
    const unit = detectBracketUnitInCell(text, offset);
    expect(unit?.kind).toBe("link");
    expect(unit?.to).toBe(text.indexOf("(./a.md)") + "(./a.md)".length);
  });

  it("cell 内行内代码中的括号不配对", () => {
    const { text, offset } = at("`f(x|)`");
    expect(detectBracketUnitInCell(text, offset)).toBeNull();
  });
});

describe("U-ESC 健壮性", () => {
  it("offset 越界 → null（fail closed）", () => {
    expect(detectBracketUnit("abc", -1)).toBeNull();
    expect(detectBracketUnit("abc", 99)).toBeNull();
    expect(detectBracketUnitInCell("abc", -1)).toBeNull();
    expect(detectBracketUnitInCell("abc", 99)).toBeNull();
  });

  it("空串 / 无括号 → null", () => {
    expect(detectBracketUnit("", 0)).toBeNull();
    expect(detectBracketUnit("纯文本", 3)).toBeNull();
  });
});

describe("U7d 裸 URL run 切片（spec §13 / HIGH-1）", () => {
  it("URL 内括号不配对：Wikipedia Foo_(bar) 案 → null（fail closed）", () => {
    const text = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(detectBracketUnitInLineRuns(text, text.indexOf("(bar") + 4)).toBeNull();
    expect(detectBracketUnitInLineRuns(text, text.indexOf("Foo_") + 5)).toBeNull();
  });

  it("跨 URL 的括号不配对（切段后各 run 内不闭合 → fail closed）", () => {
    const text = "foo(bar https://example.com/x baz)";
    expect(detectBracketUnitInLineRuns(text, 3), "cursor 在 ( 处").toBeNull();
    expect(detectBracketUnitInLineRuns(text, text.length - 1), "cursor 在配对 ) 之前").toBeNull();
  });

  it("无裸 URL 时与主函数完全等价（回归安全）", () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["foo()", 4],
      ["foo()", 3],
      ["foo()", 5],
      ["foo(xxxxxx)", 6],
      ["- 说明（尾", 5],
      ["见 [文本](./x.md) 结束", 9],
    ];
    for (const [text, offset] of cases) {
      expect(detectBracketUnitInLineRuns(text, offset), `${text}@${offset}`).toEqual(
        detectBracketUnit(text, offset),
      );
    }
  });

  it("https link 整体跳不受 URL 切割影响（T9 回归）", () => {
    const text = "见 [文本](https://e.com/a_(b)) 结束";
    const unit = detectBracketUnitInLineRuns(text, "见 [文本".length);
    if (unit === null) {
      throw new Error("https link 应仍识别为整体单元");
    }
    expect(unit.kind).toBe("link");
    expect(text.slice(unit.from, unit.to)).toBe("[文本](https://e.com/a_(b))");
  });
});
