/**
 * @file coverage.test.ts
 * @description 解析覆盖度投影（`projectCoverage`）的单元测试。
 *
 * 重点锁定一条被审查指出、且逻辑上必然成立的缺陷路径：
 * `LanguageState.apply` 对每次编辑只给 20ms 预算（`Work.Apply`），超时即
 * `takeTree()` 在 `parsedPos` 处截断，使 `tree.length < doc.length`。
 * 此时若仍声明 `complete: true`，`parse-progress.ts` 的
 * `parseCoverageAdvanced()` 两个条件都不成立，后台解析补齐后**永不**派发
 * `refreshMarkdownParseCoverageEffect` ⇒ 截断点之后的过期记录永久残留。
 */
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { projectCoverage } from "../../src/markdown/coverage.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";

function createLazyState(): EditorState {
  const doc = Array.from({ length: 3000 }, (_, i) => `## S${i}\n\nBody ${i}.\n`).join("\n");
  // 刻意**不**访问语法树：LanguageState 是惰性的，此时树是空的/极小的。
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: M1_MARKDOWN_EXTENSIONS })],
  });
}

describe("projectCoverage：解析预算截断防护", () => {
  it("语法树未覆盖全文时不得声明 complete", () => {
    const state = createLazyState();
    // 前提自检：此时树确实没覆盖全文。
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
    expect(syntaxTree(state).length).toBeLessThan(state.doc.length);

    // 即便上一轮是 complete，也不得沿用 —— 这是被修复的缺陷核心。
    const projected = projectCoverage({ to: state.doc.length, complete: true }, state);

    expect(projected.complete).toBe(false);
    expect(projected.to).toBeLessThan(state.doc.length);
    // `to` 必须是真实解析深度，供 parse-progress 在后台解析推进后比对。
    expect(projected.to).toBe(Math.min(syntaxTree(state).length, state.doc.length));
  });

  it("partial 时的 to 派生自当前语法树深度（树推进则 to 自动前进）", () => {
    const state = createLazyState();
    const projected = projectCoverage({ to: state.doc.length, complete: true }, state);

    expect(projected.complete).toBe(false);
    // `to` 直接取自 `syntaxTree(state).length`，而不是沿用传入的旧值。
    expect(projected.to).toBe(Math.min(syntaxTree(state).length, state.doc.length));
    // 关键：传入的旧 `to` 是 doc.length（谎报），投影后必须缩回真实深度。
    expect(projected.to).toBeLessThan(state.doc.length);
    // 正因 `to` 派生自活树，后台解析推进后 `parseCoverageAdvanced()` 的
    // `currentTo > index.coverage.to` 才会成立并触发刷新。
  });

  it("上一轮不完整时保持不完整，to 不前进", () => {
    const state = createLazyState();
    const projected = projectCoverage({ to: 100, complete: false }, state);
    expect(projected).toEqual({ to: 100, complete: false });
  });

  it("语法树完整覆盖时才允许 complete（正常打字路径）", () => {
    const state = createLazyState();
    ensureSyntaxTree(state, state.doc.length, 5_000);
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);

    const projected = projectCoverage({ to: state.doc.length, complete: true }, state);
    expect(projected).toEqual({ to: state.doc.length, complete: true });
  });
});
