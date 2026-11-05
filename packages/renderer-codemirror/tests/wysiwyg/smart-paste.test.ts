import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { editorModeField } from "../../src/mode.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/projections/code-block-projection.ts";
import {
  convertHtmlToMarkdown,
  handleSmartPaste,
  isCodeContext,
  type SmartPasteEvent,
  type SmartPasteView,
  stripTrackingParams,
} from "../../src/wysiwyg/input/smart-paste.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/state/change-protection.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/state/projection-field.ts";

function createHarness(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
) {
  let state = EditorState.create({
    doc,
    selection,
    extensions: [
      history(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: M1_MARKDOWN_EXTENSIONS, addKeymap: false }),
      editorModeField,
      markdownRangeIndexField,
      codeBlockLineNumbersField,
      configureWysiwygProjectionFeatures(["blocks", "headings", "inline-styles", "links"]),
      wysiwygProjectionField,
      wysiwygChangeProtection,
    ],
  });

  const view: SmartPasteView = {
    get state() {
      return state;
    },
    dispatch(...specs: readonly TransactionSpec[]) {
      for (const spec of specs) {
        state = state.update(spec).state;
      }
    },
  };

  return {
    get state() {
      return state;
    },
    setSelection(sel: EditorSelection | SelectionRange) {
      state = state.update({ selection: sel }).state;
    },
    paste(clipboard: { html?: string; plain?: string; shiftKey?: boolean }): boolean {
      let prevented = false;
      const event: SmartPasteEvent = {
        clipboardData: {
          getData: (type: string) => {
            if (type === "text/html") return clipboard.html ?? "";
            if (type === "text/plain") return clipboard.plain ?? "";
            return "";
          },
        },
        shiftKey: Boolean(clipboard.shiftKey),
        preventDefault: () => {
          prevented = true;
        },
      };
      const handled = handleSmartPaste(event, view);
      return handled && prevented;
    },
    undo(): boolean {
      return undo({
        state,
        dispatch: (tr) => {
          state = state.update(tr).state;
        },
      });
    },
  };
}

describe("Smart Paste Pipeline", () => {
  describe("convertHtmlToMarkdown unit tests", () => {
    it("TC-PASTE-1: converts external HTML with headings, strong, links to clean GFM", () => {
      const html =
        '<h1>Title</h1><p>Text with <strong>bold</strong> and <a href="https://example.com">link</a></p>';
      const md = convertHtmlToMarkdown(html);
      expect(md).toContain("# Title");
      expect(md).toContain("**bold**");
      expect(md).toContain("[link](https://example.com)");
    });

    it("TC-PASTE-2: strips script, style, and dirty inline attributes", () => {
      const html =
        '<script>alert(1)</script><div style="color:red" class="wrapper"><p onclick="foo()">Safe text</p></div>';
      const md = convertHtmlToMarkdown(html);
      expect(md).not.toContain("script");
      expect(md).not.toContain("alert");
      expect(md).not.toContain("style");
      expect(md).not.toContain("onclick");
      expect(md).toBe("Safe text");
    });

    it("TC-PASTE-3: converts lists and GFM tables properly", () => {
      const html =
        "<ul><li>Item A</li><li>Item B</li></ul><table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>D1</td><td>D2</td></tr></tbody></table>";
      const md = convertHtmlToMarkdown(html);
      expect(md).toContain("-   Item A");
      expect(md).toContain("-   Item B");
      expect(md).toContain("| H1 | H2 |");
      expect(md).toContain("| D1 | D2 |");
    });

    it("preserves fenced code block with detected language", () => {
      const html =
        '<pre><code class="language-typescript">const x = 1;\nconsole.log(x);</code></pre>';
      const md = convertHtmlToMarkdown(html);
      expect(md).toContain("```typescript");
      expect(md).toContain("const x = 1;\nconsole.log(x);");
      expect(md).toContain("```");
    });

    it("strips tracking parameters from links", () => {
      const url = "https://example.com/post?utm_source=twitter&utm_medium=social&id=123";
      const cleaned = stripTrackingParams(url);
      expect(cleaned).toBe("https://example.com/post?id=123");
    });
  });

  describe("EditorView paste event integration tests", () => {
    it("TC-PASTE-1 (Integration): converts pasted rich-text in normal paragraph", () => {
      const harness = createHarness("Hello \nworld");
      // 光标定位在第 6 个字符（Hello 后面）
      harness.setSelection(EditorSelection.cursor(6));

      const prevented = harness.paste({
        html: "<strong>world</strong>",
        plain: "world",
      });

      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toBe("Hello **world**\nworld");
    });

    it("TC-PASTE-4: bypasses HTML conversion inside fenced code blocks and preserves plain text", () => {
      const initialDoc = "```ts\n\n```";
      const harness = createHarness(initialDoc);
      // 光标定位在第 6 个字符（代码块内部第二行）
      harness.setSelection(EditorSelection.cursor(6));
      expect(isCodeContext(harness.state, 6, 6)).toBe(true);

      const prevented = harness.paste({
        html: "<h1>Dirty HTML</h1>",
        plain: "const count = 100;",
      });

      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toBe("```ts\nconst count = 100;\n```");
    });

    it("TC-PASTE-5: bypasses HTML conversion inside inline code", () => {
      const initialDoc = "Here is `code` today";
      const harness = createHarness(initialDoc);
      // 光标定位在 inline code 内部末尾（index 13，即 e 之后、反引号之前）
      harness.setSelection(EditorSelection.cursor(13));
      expect(isCodeContext(harness.state, 13, 13)).toBe(true);

      const prevented = harness.paste({
        html: "<em>italic</em>",
        plain: "test",
      });

      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toBe("Here is `codetest` today");
    });

    it("TC-PASTE-6: Shift+Paste bypasses rich-text conversion", () => {
      const harness = createHarness("Start: ");
      harness.setSelection(EditorSelection.cursor(7));

      const prevented = harness.paste({
        html: "<b>Bold</b>",
        plain: "Bold",
        shiftKey: true,
      });

      // Shift+Paste 应当交回原生处理，不被 smartPaste 拦截 preventDefault
      expect(prevented).toBe(false);
      expect(harness.state.doc.toString()).toBe("Start: ");
    });

    it("TC-PASTE-7: preserves Smart Link wrapping for URL on non-empty selection", () => {
      const harness = createHarness("Search on Google here");
      // 选中 "Google" (from 10 to 16)
      harness.setSelection(EditorSelection.range(10, 16));

      const prevented = harness.paste({
        html: '<a href="https://google.com">Google</a>',
        plain: "https://google.com",
      });

      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toBe("Search on [Google](https://google.com) here");
    });

    it("TC-PASTE-8: single step Cmd+Z undo completely restores previous document state", () => {
      const harness = createHarness("Paragraph ");
      harness.setSelection(EditorSelection.cursor(10));

      const prevented = harness.paste({
        html: "<em>emphasized</em>",
        plain: "emphasized",
      });
      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toBe("Paragraph *emphasized*");

      // 执行一次 undo
      const undone = harness.undo();
      expect(undone).toBe(true);
      expect(harness.state.doc.toString()).toBe("Paragraph ");
    });

    it("TC-PASTE-9: preserves 4-space indent in code block paste", () => {
      const initialDoc = "```python\ndef test():\n    pass\n```";
      const harness = createHarness(initialDoc);
      // 光标定位在 pass 行起始处
      const passLineStart = harness.state.doc.line(3).from;
      harness.setSelection(EditorSelection.cursor(passLineStart));

      const prevented = harness.paste({
        html: "<div>    print(1)</div>",
        plain: "    print(1)\n",
      });

      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toContain("    print(1)\n    pass");
    });
  });
});
