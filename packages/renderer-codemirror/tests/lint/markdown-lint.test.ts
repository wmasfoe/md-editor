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
  });

  it("returns empty array for clean markdown", () => {
    const doc = "# Heading\n\nParagraph text with clean spacing.\n";
    const state = EditorState.create({ doc });
    const diagnostics = runMarkdownLint(state);
    expect(diagnostics).toHaveLength(0);
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
