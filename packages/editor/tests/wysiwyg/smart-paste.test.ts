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
  shouldConvertClipboardHtml,
  type SmartPasteClipboardData,
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
    paste(clipboard: {
      html?: string;
      plain?: string;
      shiftKey?: boolean;
      types?: readonly string[];
      extra?: Readonly<Record<string, string>>;
    }): boolean {
      let prevented = false;
      const data: SmartPasteClipboardData = {
        types: clipboard.types,
        getData: (type: string) => {
          if (type === "text/html") return clipboard.html ?? "";
          if (type === "text/plain") return clipboard.plain ?? "";
          return clipboard.extra?.[type] ?? "";
        },
      };
      const event: SmartPasteEvent = {
        clipboardData: data,
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

    it("converts headerless Excel, Sheets, and Word tables to GFM without raw attributes", () => {
      const fixtures = [
        {
          name: "excel",
          html: `<table style="border-collapse:collapse" class="xltable" onclick="alert(1)"><tbody><tr><td style="font-weight:bold" class="xl1" onclick="alert(1)"><span style="color:red" onclick="alert(2)">Name</span></td><td style="color:red" class="xl2">Score</td></tr><tr><td>Ada<br>Lovelace</td><td>10</td></tr></tbody></table>`,
          markdown: "| Name | Score |\n| --- | --- |\n| Ada Lovelace | 10 |",
        },
        {
          name: "google-sheets",
          html: `<google-sheets-html-origin><meta charset="utf-8"><table><tr><td data-sheets-value="{&quot;1&quot;:2}">City</td><td>Pop</td></tr><tr><td>Paris</td><td>2</td></tr></table>`,
          markdown: "| City | Pop |\n| --- | --- |\n| Paris | 2 |",
        },
        {
          name: "word",
          html: `<table class="MsoTableGrid" style="border-collapse:collapse;border:none"><tr><td style="border:solid windowtext 1.0pt"><p class="MsoNormal">H1</p></td><td><p class="MsoNormal">H2</p></td></tr><tr><td><p class="MsoNormal">a</p></td><td><p class="MsoNormal"><b>b</b></p></td></tr></table>`,
          markdown: "| H1 | H2 |\n| --- | --- |\n| a | **b** |",
        },
      ];
      for (const fixture of fixtures) {
        const md = convertHtmlToMarkdown(fixture.html);
        expect(md).toBe(fixture.markdown);
        expect(md).not.toMatch(/style\s*=|class\s*=|onclick|data-sheets|<t[dhr]\b|<table/i);
      }
    });

    it("escapes pipe characters inside headerless table cells", () => {
      const md = convertHtmlToMarkdown(
        "<table><tr><td>a|b</td><td>c</td></tr><tr><td>1</td><td>2</td></tr></table>",
      );
      expect(md).toBe("| a\\|b | c |\n| --- | --- |\n| 1 | 2 |");
    });

    it("drops data: and file: from link href and image src", () => {
      const md = convertHtmlToMarkdown(
        [
          '<a href="javascript:alert(1)">js</a>',
          '<a href="vbscript:msgbox(1)">vb</a>',
          '<a href="data:text/html,hi">data link</a>',
          '<a href="file:///etc/passwd">file link</a>',
          '<a href="DATA:text/html,HI">data upper</a>',
          '<a href="File:///tmp/x">file upper</a>',
          '<a href="https://example.com/ok">ok</a>',
          '<a href="mailto:a@b.c">mail</a>',
          '<a href="/docs/readme">docs</a>',
          '<a href=" javascript:alert(1)">padded js</a>',
          '<img alt="data img" src="data:text/html,hi">',
          '<img alt="file img" src="file:///tmp/x.png">',
          '<img alt="svg img" src="data:image/svg+xml,<svg>">',
          '<img alt="png img" src="data:image/png;base64,AAAA">',
          '<img alt="safe" src="https://example.com/a.png">',
          '<img alt="rel" src="pic.png">',
        ].join(" "),
      );
      expect(md).not.toMatch(/javascript:|vbscript:|data:|file:/i);
      expect(md).toContain("data link");
      expect(md).toContain("file link");
      expect(md).toContain("data upper");
      expect(md).toContain("file upper");
      expect(md).toContain("data img");
      expect(md).toContain("file img");
      expect(md).toContain("svg img");
      expect(md).toContain("png img");
      expect(md).toContain("[ok](https://example.com/ok)");
      expect(md).toContain("[mail](mailto:a@b.c)");
      expect(md).toContain("[docs](/docs/readme)");
      expect(md).toContain("padded js");
      expect(md).not.toContain("javascript:alert");
      expect(md).toContain("![safe](https://example.com/a.png)");
      expect(md).toContain("![rel](pic.png)");
      expect(md).not.toContain("](data:");
      expect(md).not.toContain("](file:");
      expect(md).not.toContain("](DATA:");
      expect(md).not.toContain("](File:");
    });

    it("escapes double quotes in link titles", () => {
      const md = convertHtmlToMarkdown(`<a href="https://example.com" title='say "hi"'>t</a>`);
      expect(md).toBe('[t](https://example.com "say \\"hi\\"")');
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

    it("keeps IDE plain text indentation and markdown characters in a normal paragraph", () => {
      const plain = "function f() {\n    const a_b_c = 1;\n    return `# [${a_b_c}]`;\n}";
      const vscodeHtml = [
        `<meta charset="utf-8">`,
        `<div style="color:#bbbbbb;background-color:#1e1e1e;font-family:Menlo;white-space:pre">`,
        `<div><span style="color:#569cd6;">function</span><span style="color:#d4d4d4;"> f() {</span></div>`,
        `<div><span style="color:#d4d4d4;">    const a_b_c = 1;</span></div>`,
        `<div><span style="color:#c586c0;">    return</span><span style="color:#d4d4d4;"> \`# [\${a_b_c}]\`;</span></div>`,
        `<div><span style="color:#d4d4d4;">}</span></div>`,
        `</div>`,
      ].join("");
      const jetbrainsHtml = [
        `<html><body><!--StartFragment-->`,
        `<pre style="font-family:'JetBrains Mono',monospace">`,
        `<span style="color:#CC7832;">function</span><span style="color:#A9B7C6;"> f() {</span>`,
        `<span style="color:#A9B7C6;">\n    const a_b_c = 1;</span>`,
        `<span style="color:#A9B7C6;">\n    return \`# [\${a_b_c}]\`;</span>`,
        `<span style="color:#A9B7C6;">\n}</span>`,
        `</pre><!--EndFragment--></body></html>`,
      ].join("");

      const cases: ReadonlyArray<{
        html: string;
        types: readonly string[];
        extra?: Readonly<Record<string, string>>;
      }> = [
        {
          html: vscodeHtml,
          types: ["text/html", "text/plain", "vscode-editor-data"],
          extra: { "vscode-editor-data": JSON.stringify({ version: 1, mode: "typescript" }) },
        },
        {
          html: jetbrainsHtml,
          types: ["text/html", "text/plain"],
        },
      ];

      for (const clipboardCase of cases) {
        const initial = "Note:\n";
        const harness = createHarness(initial);
        harness.setSelection(EditorSelection.cursor(initial.length));
        const clipboard: SmartPasteClipboardData = {
          types: clipboardCase.types,
          getData: (type: string) => {
            if (type === "text/html") return clipboardCase.html;
            if (type === "text/plain") return plain;
            return clipboardCase.extra?.[type] ?? "";
          },
        };
        // 没有有意义的富结构：不能拦截。CodeMirror 随后插入的就是这份 text/plain。
        expect(shouldConvertClipboardHtml(clipboard)).toBe(false);
        expect(
          harness.paste({
            html: clipboardCase.html,
            plain,
            types: clipboardCase.types,
            extra: clipboardCase.extra,
          }),
        ).toBe(false);
        expect(harness.state.doc.toString()).toBe(initial);

        const converted = convertHtmlToMarkdown(clipboardCase.html);
        expect(converted).not.toBe(plain);
        expect(converted).toContain("a\\_b\\_c");
        expect(plain).toContain("    const a_b_c = 1;");
        expect(plain).toContain("`# [${a_b_c}]`");
      }
    });

    it("keeps web-page plain text with markdown characters on the native text/plain path", () => {
      const plain = "a_b_c *stars* # not a heading [brackets]";
      const html = `<html><body><!--StartFragment--><p><span style="color: rgb(0, 0, 0); font-family: Arial;">a_b_c *stars* # not a heading [brackets]</span></p><!--EndFragment--></body></html>`;
      const clipboard: SmartPasteClipboardData = {
        types: ["text/html", "text/plain"],
        getData: (type: string) => {
          if (type === "text/html") return html;
          if (type === "text/plain") return plain;
          return "";
        },
      };
      expect(shouldConvertClipboardHtml(clipboard)).toBe(false);

      const harness = createHarness("Paragraph.\n");
      harness.setSelection(EditorSelection.cursor(harness.state.doc.length));
      expect(harness.paste({ html, plain, types: ["text/html", "text/plain"] })).toBe(false);
      expect(harness.state.doc.toString()).toBe("Paragraph.\n");
      expect(convertHtmlToMarkdown(html)).toContain("a\\_b\\_c");
    });

    it("does not treat the Google Docs font-weight:normal wrapper as rich text", () => {
      const plain = "hello a_b_c";
      const html = `<b style="font-weight:normal;" id="docs-internal-guid-abc"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt">hello a_b_c</span></p></b>`;
      const harness = createHarness("");
      expect(
        harness.paste({
          html,
          plain,
          types: ["text/html", "text/plain"],
        }),
      ).toBe(false);
      expect(harness.state.doc.toString()).toBe("");
      expect(convertHtmlToMarkdown(html)).toContain("\\_");
    });

    it("still converts real emphasis wrapped in presentational spans", () => {
      const harness = createHarness("");
      const prevented = harness.paste({
        html: `<div><p><span style="color:red"><b>bold</b> a_b_c</span></p></div>`,
        plain: "bold a_b_c",
        types: ["text/html", "text/plain"],
      });
      expect(prevented).toBe(true);
      expect(harness.state.doc.toString()).toContain("**bold**");
      expect(harness.state.doc.toString()).toContain("a\\_b\\_c");
    });

    it("pastes a headerless spreadsheet table as a GFM table", () => {
      const html = `<table style="border-collapse:collapse" class="xl" onclick="alert(1)"><tr><td style="color:red" class="xl1">Name</td><td>Score</td></tr><tr><td>Ada</td><td>10</td></tr></table>`;
      const harness = createHarness("Before\n");
      harness.setSelection(EditorSelection.cursor(harness.state.doc.length));
      const prevented = harness.paste({
        html,
        plain: "Name\tScore\nAda\t10",
        types: ["text/html", "text/plain"],
      });
      expect(prevented).toBe(true);
      const doc = harness.state.doc.toString();
      expect(doc).toContain("| Name | Score |");
      expect(doc).toContain("| --- | --- |");
      expect(doc).toContain("| Ada | 10 |");
      expect(doc).not.toMatch(/style\s*=|class\s*=|onclick|<td|<table/i);
    });
  });
});
