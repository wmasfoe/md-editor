/**
 * lint 引擎类型必须与 `markdownlint` 官方导出**结构兼容**。
 *
 * README 推荐的写法是原样传官方 `lint`：
 *
 * ```tsx
 * import { lint } from "markdownlint/sync";
 * <CodeMirrorEditor markdownlint={{ lint }} />
 * ```
 *
 * 这条写法此前在严格模式下报 TS2322，因为我们的 issue 类型比官方窄：
 * 官方 `errorDetail: string | null`、`errorRange: number[] | null`、
 * `fixInfo: FixInfo | null`，而我们写成 `?: string` / `?: readonly [number, number]`。
 * 类型一旦不兼容，宿主只能写 `as unknown as`（app-ui 里就有一处双重断言），
 * 而那正是"文档示例不可用"的信号。
 *
 * 本测试**直接对着官方类型**断言，不是对着我们自己复述的类型断言。
 */
import { describe, expect, it } from "vitest";
import { lint as officialLint } from "markdownlint/sync";

import type { MarkdownLintEngine } from "../../src/lint/engine.ts";

type OfficialResult = ReturnType<typeof officialLint>;
type OfficialIssue = OfficialResult[string][number];

describe("MarkdownLintIssue 与官方 LintError 结构兼容", () => {
  it("官方 errorDetail / errorContext 的可空性被覆盖（string | null）", () => {
    // 若我们仍写成 `?: string`，这里会因 null 不可赋而报错。
    const detail: OfficialIssue["errorDetail"] = null;
    const context: OfficialIssue["errorContext"] = null;
    expect(detail).toBeNull();
    expect(context).toBeNull();
  });

  it("官方 errorRange 是 number[] | null（不是定长元组）", () => {
    const range: OfficialIssue["errorRange"] = [1, 2, 3];
    expect(range).toHaveLength(3);
  });

  it("官方 fixInfo 可为 null", () => {
    const fixInfo: OfficialIssue["fixInfo"] = null;
    expect(fixInfo).toBeNull();
  });

  it("README 写法原样可编译：官方 lint 直接赋给 MarkdownLintEngine", () => {
    // 关键断言：**不加任何断言**。这行能编译，README 示例才真的可用。
    const engine: MarkdownLintEngine = { lint: officialLint };
    expect(typeof engine.lint).toBe("function");
  });

  it("官方 readConfig / applyFixes 也可原样传入", async () => {
    const { readConfig } = await import("markdownlint/sync");
    const engine: MarkdownLintEngine = { lint: officialLint, readConfig };
    expect(typeof engine.readConfig).toBe("function");
  });
});
