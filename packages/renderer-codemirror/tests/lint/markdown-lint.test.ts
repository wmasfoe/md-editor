import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { runMarkdownLint } from "../../src/lint/markdown-lint.ts";
import { runLinkValidation } from "../../src/lint/link-lint.ts";

describe("markdown-lint in editor", () => {
  it("detects markdown syntax style issues", () => {
    // 多个连续空行违反 MD012 (no-multiple-blanks)
    const doc = "# Heading\n\n\n\nParagraph text";
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);

    expect(diagnostics.length).toBeGreaterThan(0);
    const issue = diagnostics.find(
      (d) => d.message.includes("MD012") || d.message.includes("multiple-blanks"),
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.renderMessage).toBeTypeOf("function");

    const origDoc = (globalThis as unknown as { document?: unknown }).document;
    let node: unknown;
    try {
      (globalThis as unknown as { document?: unknown }).document = {
        createElement: (tag: string) => ({
          tagName: tag,
          className: "",
          appendChild(child: unknown) {
            const self = this as { children?: unknown[] };
            self.children = self.children ?? [];
            self.children.push(child);
          },
          textContent: "",
        }),
      };
      node = issue?.renderMessage?.({} as never);
    } finally {
      (globalThis as unknown as { document?: unknown }).document = origDoc;
    }

    expect(node).toBeDefined();
    expect((node as unknown as { className?: string })?.className).toContain(
      "cm-liquid-diagnostic",
    );
  });

  it("provides localized Chinese descriptions and aliases for markdownlint rules", () => {
    // 标题层级跳级违反 MD001 (heading-increment)
    const doc = "# H1\n\n### H3\n";
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);

    const md001 = diagnostics.find((d) => d.message.includes("MD001"));
    expect(md001).toBeDefined();
    expect(md001?.message).toContain("标题层级递增");
    expect(md001?.message).toContain("期望");
  });

  it("extracts fixInfo into structured Chinese suggestion and provides Quick Fix action", () => {
    // MD018: 标题后缺少空格
    const doc = "#Heading without space\n";
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);

    const md018 = diagnostics.find((d) => d.message.includes("MD018"));
    expect(md018).toBeDefined();
    expect(md018?.message).toContain("建议：在此处补充一个空格");
    expect(md018?.actions).toBeDefined();
    expect(md018?.actions?.[0].name).toBe("一键修复");
  });

  it("does not flag trailing spaces during drafting by default", () => {
    // 验证 MD009 (no-trailing-spaces) 默认不产生骚扰性红线
    const doc = "# Heading\nParagraph with trailing space   \n";
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);

    const trailingSpaceIssue = diagnostics.find(
      (d) => d.message.includes("MD009") || d.message.includes("no-trailing-spaces"),
    );
    expect(trailingSpaceIssue).toBeUndefined();
  });

  it("returns empty array for clean markdown", () => {
    const doc = "# Heading\n\nParagraph text with clean spacing.\n";
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);
    expect(diagnostics).toHaveLength(0);
  });

  it("allows duplicate subheadings under different parent sections (MD024 siblings_only: true)", () => {
    const doc = [
      "# Section 1",
      "",
      "### Subheading",
      "",
      "Content 1",
      "",
      "# Section 2",
      "",
      "### Subheading",
      "",
      "Content 2",
      "",
    ].join("\n");
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);
    const md024 = diagnostics.find((d) => d.message.includes("MD024"));
    expect(md024).toBeUndefined();
  });

  it("validates local relative links against external validator results", async () => {
    const doc = "[Valid Link](./doc.md)\n[Missing Image](./missing.png)";
    const state = EditorState.create({ doc });

    const diagnostics = await runLinkValidation(state, {
      validateLinks: async () => [
        {
          line: 2,
          col: 1,
          target: "./missing.png",
          message: "相对文件 ./missing.png 未找到",
          severity: "error",
        },
      ],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("missing.png");
    expect(diagnostics[0].message).toContain("未找到");
    expect(diagnostics[0].severity).toBe("error");
  });
});
