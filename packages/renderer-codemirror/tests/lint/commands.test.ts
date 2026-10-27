import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import {
  collectFixableMarkdownLintChanges,
  filterNonOverlappingDescendingChanges,
  fixAllMarkdownLintIssues,
  runMarkdownLintCommand,
  clearMarkdownLintCommand,
  countActiveMarkdownLintDiagnostics,
  type MarkdownLintTextChange,
} from "../../src/lint/commands.ts";

function createTestEditor(doc: string): { view: EditorView; getState: () => EditorState } {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(0),
    extensions: [
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      history(),
      markdownRangeIndexField,
    ],
  });

  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0] | ReturnType<EditorState["update"]>) {
      state = ("state" in spec && spec.state ? spec : state.update(spec as never)).state;
    },
    focus() {},
  } as unknown as EditorView;

  return { view, getState: () => state };
}

describe("MarkdownLint 快捷键与批量修复命令 (commands.ts)", () => {
  it("filterNonOverlappingDescendingChanges 按 from 降序排列并过滤重叠区间", () => {
    const changes: MarkdownLintTextChange[] = [
      { from: 10, to: 20, insert: "a" },
      { from: 50, to: 60, insert: "b" },
      { from: 15, to: 25, insert: "overlap-with-first" },
      { from: 30, to: 40, insert: "c" },
    ];

    const filtered = filterNonOverlappingDescendingChanges(changes);
    // 降序排序后 50..60, 30..40, 15..25（10..20 与 15..25 重叠被过滤）
    expect(filtered.map((c) => [c.from, c.to])).toEqual([
      [50, 60],
      [30, 40],
      [15, 25],
    ]);
  });

  it("runMarkdownLintCommand 分发诊断并返回统计数据", () => {
    // 存在 MD012 (连续空行)
    const badDoc = "# 标题\n\n\n\n正文内容";
    const { view } = createTestEditor(badDoc);

    const result = runMarkdownLintCommand(view);
    expect(result.total).toBeGreaterThan(0);
    expect(result.errors).toBeGreaterThan(0);
  });

  it("fixAllMarkdownLintIssues 一键批量修复全文所有可修复规范问题", () => {
    // 包含 MD012 (多余连续空行) 和 MD018 (标题后缺少空格: #标题 -> # 标题)
    const messyDoc = "#标题\n\n\n\n正文段落第一行\n\n\n\n##第二级标题\n\n正文段落第二行";
    const { view, getState } = createTestEditor(messyDoc);

    const fixResult = fixAllMarkdownLintIssues(view);
    expect(fixResult.appliedCount).toBeGreaterThan(0);

    const fixedDoc = getState().doc.toString();
    // 验证多余空行被缩减，标题补齐空格
    expect(fixedDoc).toContain("# 标题");
    expect(fixedDoc).toContain("## 第二级标题");
    expect(fixedDoc).not.toContain("\n\n\n\n");

    // 再次执行，已无残留可修复项
    const secondResult = fixAllMarkdownLintIssues(view);
    expect(secondResult.appliedCount).toBe(0);
  });

  it("fixAllMarkdownLintIssues 支持单次 Cmd+Z 原子撤销所有批量变更", () => {
    const originalDoc = "#标题\n\n\n\n正文内容\n\n\n\n##子标题";
    const { view, getState } = createTestEditor(originalDoc);

    fixAllMarkdownLintIssues(view);
    expect(getState().doc.toString()).not.toBe(originalDoc);

    // 触发单次 undo
    const undone = undo(view);
    expect(undone).toBe(true);

    // 核心契约：单步 Undo 必须 100% 还原回原始文档字符
    expect(getState().doc.toString()).toBe(originalDoc);
  });

  it("collectFixableMarkdownLintChanges 尊重 Frontmatter 豁免区", () => {
    const docWithFrontmatter = `---
title: 测试标题
# Frontmatter 内部的类 Markdown 语法不应被当成正文标题修复
---

# 正文标题
`;
    const { view } = createTestEditor(docWithFrontmatter);
    const changes = collectFixableMarkdownLintChanges(view.state);
    // frontmatter 内部不产生修复项
    const changesInFrontmatter = changes.filter((c) => c.from < 50);
    expect(changesInFrontmatter).toHaveLength(0);
  });

  it("runMarkdownLintCommand 在存在问题时尝试呼出面板，在无问题时统计为 0", () => {
    let panelOpened = false;

    const mockView = {
      ...createTestEditor("# 标题\n\n\n\n正文").view,
      plugin: () => {
        panelOpened = true;
        return null;
      },
    } as unknown as EditorView;

    const result = runMarkdownLintCommand(mockView);
    expect(panelOpened).toBe(true);
    expect(result.total).toBeGreaterThan(0);

    const cleanView = createTestEditor("# 标题\n\n正文\n").view;
    const cleanResult = runMarkdownLintCommand(cleanView);
    expect(cleanResult.total).toBe(0);
    expect(cleanResult.toggledOff).toBe(false);
  });

  it("runMarkdownLintCommand 支持 Toggle 语义：在已校验状态下再次执行即关闭并清除标记", () => {
    const { view } = createTestEditor("# 标题\n\n\n\n正文内容");

    // 第一次执行：分发诊断并打开面板
    const firstResult = runMarkdownLintCommand(view);
    expect(firstResult.total).toBeGreaterThan(0);
    expect(firstResult.toggledOff).toBe(false);
    expect(countActiveMarkdownLintDiagnostics(view.state)).toBeGreaterThan(0);

    // 第二次执行：触发 Toggle Off，自动清空所有诊断标记与面板
    const toggleResult = runMarkdownLintCommand(view);
    expect(toggleResult.toggledOff).toBe(true);
    expect(toggleResult.total).toBe(0);
    expect(countActiveMarkdownLintDiagnostics(view.state)).toBe(0);

    // 第三次执行：再次开启
    const thirdResult = runMarkdownLintCommand(view);
    expect(thirdResult.toggledOff).toBe(false);
    expect(thirdResult.total).toBeGreaterThan(0);
    expect(countActiveMarkdownLintDiagnostics(view.state)).toBeGreaterThan(0);
  });

  it("clearMarkdownLintCommand 可直接清除所有 markdownlint 诊断并关闭面板", () => {
    const { view } = createTestEditor("# 标题\n\n\n\n正文内容");
    runMarkdownLintCommand(view);
    expect(countActiveMarkdownLintDiagnostics(view.state)).toBeGreaterThan(0);

    clearMarkdownLintCommand(view);
    expect(countActiveMarkdownLintDiagnostics(view.state)).toBe(0);
  });
});
