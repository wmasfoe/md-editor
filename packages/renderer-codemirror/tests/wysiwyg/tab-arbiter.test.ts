import { describe, expect, it } from "vitest";
import {
  decideTabActions,
  dispatchTabActions,
  type TabAction,
} from "../../src/wysiwyg/tab-arbiter.ts";

/**
 * AC-MB1：统一 Tab arbiter **纯决策函数**的属性测试（终局 code-review T13 的治本）。
 *
 * D2 全序（单一定义点）：
 *   composing → []（放行原生）
 *   accept-suggestion(有建议时) → code-block(非表格) → escape-bracket → 尾部(structured | table-next-cell)
 *
 * 断言方式 = **对全部上下文组合枚举做序不变量检查**，不看任何源码顺序（禁 grep）。
 */

/** 规范次序（尾动作随上下文切换，其余相对次序不可变） */
const CANONICAL: readonly TabAction[] = [
  "accept-suggestion",
  "code-block",
  "escape-bracket",
  "structured",
];

function subsequencesOfCanonical(actions: readonly TabAction[]): boolean {
  // structured/table-next-cell 是同一「尾位置」的两种形态
  const normalized = actions.map((a) => (a === "table-next-cell" ? "structured" : a));
  let cursor = 0;
  for (const action of normalized) {
    const idx = CANONICAL.indexOf(action, cursor);
    if (idx === -1) return false;
    cursor = idx + 1;
  }
  return true;
}

describe("decideTabActions：D2 全序属性测试", () => {
  const allContexts = [false, true].flatMap((composing) =>
    [false, true].flatMap((suggestionActive) =>
      [false, true].map((inTableCell) => ({ composing, suggestionActive, inTableCell })),
    ),
  );

  it("上下文全枚举：输出恒为规范次序的子序列（相对次序不可被调换）", () => {
    for (const ctx of allContexts) {
      const actions = decideTabActions(ctx);
      expect(
        subsequencesOfCanonical(actions),
        `次序违规：${JSON.stringify(ctx)} → ${JSON.stringify(actions)}`,
      ).toBe(true);
    }
  });

  it("铁律第 1 步：composing → []（任何执行器都不出场，放行原生）", () => {
    for (const suggestionActive of [false, true]) {
      for (const inTableCell of [false, true]) {
        expect(
          decideTabActions({ composing: true, suggestionActive, inTableCell }),
          "IME 组合期不得调度任何 Tab 执行器",
        ).toEqual([]);
      }
    }
  });

  it("建议激活时 accept-suggestion 必为第一动作；未激活时不得出现", () => {
    expect(
      decideTabActions({ composing: false, suggestionActive: true, inTableCell: false })[0],
    ).toBe("accept-suggestion");
    expect(
      decideTabActions({ composing: false, suggestionActive: true, inTableCell: true })[0],
    ).toBe("accept-suggestion");
    expect(
      decideTabActions({ composing: false, suggestionActive: false, inTableCell: false }),
    ).not.toContain("accept-suggestion");
  });

  it("🔴 CM6 腿（非表格）恒为 code-block → escape-bracket → structured（T13 全序）", () => {
    for (const suggestionActive of [false, true]) {
      expect(decideTabActions({ composing: false, suggestionActive, inTableCell: false })).toEqual(
        suggestionActive
          ? ["accept-suggestion", "code-block", "escape-bracket", "structured"]
          : ["code-block", "escape-bracket", "structured"],
      );
    }
  });

  it("🔴 表格腿：剔除 code-block，尾动作 = table-next-cell，且 escape 仍在跳格之前（PM-4 顺序契约）", () => {
    for (const suggestionActive of [false, true]) {
      const actions = decideTabActions({ composing: false, suggestionActive, inTableCell: true });
      expect(actions, "表格上下文无围栏代码块语义").not.toContain("code-block");
      expect(actions[actions.length - 1], "尾动作必须是跳下一格").toBe("table-next-cell");
      expect(
        actions.indexOf("escape-bracket"),
        "跳出必须先于 flushCellCommit/跳格（零文本变更）",
      ).toBeLessThan(actions.indexOf("table-next-cell"));
    }
  });
});

describe("dispatchTabActions 共享 runner（轮1 architect concern-7）", () => {
  it("按 decideTabActions 序列调用，首个 true 即停 → handled", () => {
    const calls: string[] = [];
    const outcome = dispatchTabActions(
      { composing: false, suggestionActive: true, inTableCell: false },
      {
        "accept-suggestion": () => {
          calls.push("accept");
          return true;
        },
        "code-block": () => {
          calls.push("code");
          return false;
        },
        "escape-bracket": () => {
          calls.push("escape");
          return false;
        },
        structured: () => {
          calls.push("structured");
          return false;
        },
      },
    );
    expect(outcome).toBe("handled");
    expect(calls, "首个 true 之后不得再调任何执行器").toEqual(["accept"]);
  });

  it("全部 false → fallthrough，按序穷尽（尾动作最后）", () => {
    const calls: string[] = [];
    const outcome = dispatchTabActions(
      { composing: false, suggestionActive: false, inTableCell: false },
      {
        "code-block": () => {
          calls.push("code");
          return false;
        },
        "escape-bracket": () => {
          calls.push("escape");
          return false;
        },
        structured: () => {
          calls.push("structured");
          return false;
        },
      },
    );
    expect(outcome).toBe("fallthrough");
    expect(calls).toEqual(["code", "escape", "structured"]);
  });

  it("composing → 零调用直接 fallthrough（铁律第 1 步）", () => {
    let called = false;
    const outcome = dispatchTabActions(
      { composing: true, suggestionActive: true, inTableCell: false },
      {
        "accept-suggestion": () => {
          called = true;
          return true;
        },
      },
    );
    expect(outcome).toBe("fallthrough");
    expect(called).toBe(false);
  });

  it("表格上下文序列：accept → escape → tail（无 code-block）", () => {
    const calls: string[] = [];
    dispatchTabActions(
      { composing: false, suggestionActive: true, inTableCell: true },
      {
        "accept-suggestion": () => {
          calls.push("accept");
          return false;
        },
        "escape-bracket": () => {
          calls.push("escape");
          return false;
        },
        "table-next-cell": () => {
          calls.push("tail");
          return false;
        },
      },
    );
    expect(calls).toEqual(["accept", "escape", "tail"]);
  });
});
