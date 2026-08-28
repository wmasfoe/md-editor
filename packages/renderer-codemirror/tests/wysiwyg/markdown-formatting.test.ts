import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownRangeIndexField } from "../../src/markdown/range-index.ts";
import { M1_MARKDOWN_EXTENSIONS } from "../../src/markdown/extensions.ts";
import { editorModeField } from "../../src/mode.ts";
import { wysiwygChangeProtection } from "../../src/wysiwyg/change-protection.ts";
import { codeBlockLineNumbersField } from "../../src/wysiwyg/code-block-projection.ts";
import {
  insertCodeBlock,
  insertOrWrapLink,
  setHeading1,
  setHeading2,
  setParagraph,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleTaskList,
} from "../../src/wysiwyg/markdown-formatting.ts";
import { isValidUrl } from "../../src/wysiwyg/smart-paste.ts";
import { smartPairsExtension } from "../../src/wysiwyg/smart-pairs.ts";
import {
  configureWysiwygProjectionFeatures,
  wysiwygProjectionField,
} from "../../src/wysiwyg/projection-state.ts";

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange = EditorSelection.cursor(0),
): EditorState {
  return EditorState.create({
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
}

function runCommand(
  command: StateCommand,
  state: EditorState,
): { handled: boolean; state: EditorState } {
  let nextState = state;
  const handled = command({
    state,
    dispatch: (tr) => {
      nextState = tr.state;
    },
  });
  return { handled, state: nextState };
}

describe("Markdown Inline Formatting Commands", () => {
  it("wraps and unwraps bold text (**)", () => {
    // 1. 选中文本包裹粗体
    const state1 = createState("hello world", EditorSelection.range(0, 5));
    const res1 = runCommand(toggleBold, state1);
    expect(res1.handled).toBe(true);
    expect(res1.state.doc.toString()).toBe("**hello** world");
    expect(res1.state.selection.main.from).toBe(2);
    expect(res1.state.selection.main.to).toBe(7);

    // 2. 选中已有粗体文本解包
    const res2 = runCommand(toggleBold, res1.state);
    expect(res2.handled).toBe(true);
    expect(res2.state.doc.toString()).toBe("hello world");

    // 3. 空光标处插入定界符
    const state3 = createState("hello ", EditorSelection.cursor(6));
    const res3 = runCommand(toggleBold, state3);
    expect(res3.handled).toBe(true);
    expect(res3.state.doc.toString()).toBe("hello ****");
    expect(res3.state.selection.main.head).toBe(8);
  });

  it("wraps and unwraps italic (*)", () => {
    const state = createState("italic text", EditorSelection.range(0, 6));
    const res1 = runCommand(toggleItalic, state);
    expect(res1.handled).toBe(true);
    expect(res1.state.doc.toString()).toBe("*italic* text");

    const res2 = runCommand(toggleItalic, res1.state);
    expect(res2.handled).toBe(true);
    expect(res2.state.doc.toString()).toBe("italic text");
  });

  it("wraps strikethrough (~~), inline code (`), and highlight (==)", () => {
    const s1 = createState("strike", EditorSelection.range(0, 6));
    const r1 = runCommand(toggleStrikethrough, s1);
    expect(r1.state.doc.toString()).toBe("~~strike~~");

    const s2 = createState("code", EditorSelection.range(0, 4));
    const r2 = runCommand(toggleInlineCode, s2);
    expect(r2.state.doc.toString()).toBe("`code`");

    const s3 = createState("highlight", EditorSelection.range(0, 9));
    const r3 = runCommand(toggleHighlight, s3);
    expect(r3.state.doc.toString()).toBe("==highlight==");
  });

  it("wraps and unwraps links [text](url)", () => {
    const state = createState("click here", EditorSelection.range(0, 10));
    const res1 = runCommand(insertOrWrapLink, state);
    expect(res1.handled).toBe(true);
    expect(res1.state.doc.toString()).toBe("[click here](url)");

    // 选中整个链接再次调用解包
    const state2 = createState(
      "[click here](url)",
      EditorSelection.range(0, "[click here](url)".length),
    );
    const res2 = runCommand(insertOrWrapLink, state2);
    expect(res2.handled).toBe(true);
    expect(res2.state.doc.toString()).toBe("click here");
  });

  it("inserts code blocks", () => {
    const state = createState("console.log('hi')", EditorSelection.range(0, 17));
    const res = runCommand(insertCodeBlock, state);
    expect(res.handled).toBe(true);
    expect(res.state.doc.toString()).toBe("```\nconsole.log('hi')\n```\n");
  });
});

describe("Markdown Block Formatting Commands", () => {
  it("toggles heading levels and clears to paragraph", () => {
    const state1 = createState("Title text", EditorSelection.cursor(2));
    const res1 = runCommand(setHeading1, state1);
    expect(res1.state.doc.toString()).toBe("# Title text");

    // 再次调用 H1 反转为普通段落
    const res2 = runCommand(setHeading1, res1.state);
    expect(res2.state.doc.toString()).toBe("Title text");

    // 设为 H2
    const res3 = runCommand(setHeading2, res2.state);
    expect(res3.state.doc.toString()).toBe("## Title text");

    // 设为段落
    const res4 = runCommand(setParagraph, res3.state);
    expect(res4.state.doc.toString()).toBe("Title text");
  });

  it("toggles blockquote (> )", () => {
    const state1 = createState("quoted text", EditorSelection.cursor(3));
    const res1 = runCommand(toggleBlockquote, state1);
    expect(res1.state.doc.toString()).toBe("> quoted text");

    const res2 = runCommand(toggleBlockquote, res1.state);
    expect(res2.state.doc.toString()).toBe("quoted text");
  });

  it("toggles bullet list, ordered list, and task list", () => {
    const s1 = createState("item one", EditorSelection.cursor(0));
    const r1 = runCommand(toggleBulletList, s1);
    expect(r1.state.doc.toString()).toBe("- item one");

    const s2 = createState("step one", EditorSelection.cursor(0));
    const r2 = runCommand(toggleOrderedList, s2);
    expect(r2.state.doc.toString()).toBe("1. step one");

    const s3 = createState("todo item", EditorSelection.cursor(0));
    const r3 = runCommand(toggleTaskList, s3);
    expect(r3.state.doc.toString()).toBe("- [ ] todo item");
  });
});

describe("Smart Link Paste & Smart Pairs", () => {
  it("validates URLs accurately", () => {
    expect(isValidUrl("https://github.com/wmasfoe/md-editor")).toBe(true);
    expect(isValidUrl("http://localhost:3000")).toBe(true);
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("ftp://files.example.com/doc.pdf")).toBe(true);
  });

  it("smart pairs wraps selection on typing delimiter", () => {
    let currentState = createState("hello world", EditorSelection.range(0, 5));
    const mockView = {
      state: currentState,
      composing: false,
      dispatch: (tr: { changes: unknown; selection: EditorSelection }) => {
        currentState = currentState.update(tr as TransactionSpec).state;
      },
    } as unknown as EditorView;

    // @ts-expect-error input handler testing
    const handled = smartPairsExtension.value(mockView, 0, 5, "*");
    expect(handled).toBe(true);
    expect(currentState.doc.toString()).toBe("*hello* world");
    expect(currentState.selection.main.from).toBe(1);
    expect(currentState.selection.main.to).toBe(6);
  });

  it("supports search and replace query execution on document", async () => {
    const { SearchQuery } = await import("@codemirror/search");
    const state = createState("The quick brown fox jumps over the lazy fox");
    const query = new SearchQuery({
      search: "fox",
      replace: "dog",
      caseSensitive: false,
    });

    const cursor = query.getCursor(state.doc);
    const matches: { from: number; to: number }[] = [];
    let item = cursor.next();
    while (!item.done) {
      matches.push({ from: item.value.from, to: item.value.to });
      item = cursor.next();
    }

    expect(matches.length).toBe(2);
    expect(matches[0]).toEqual({ from: 16, to: 19 });
    expect(matches[1]).toEqual({ from: 40, to: 43 });
  });

  it("instantiates createLiquidSearchPanel with Apple Liquid Glass structure", async () => {
    // Provide minimal mock document in Node test environment
    const originalDocument = globalThis.document;
    class MockElement {
      className = "";
      placeholder = "";
      value = "";
      title = "";
      type = "";
      textContent = "";
      #innerHTML = "";
      get innerHTML() {
        return this.#innerHTML;
      }
      set innerHTML(val: string) {
        this.#innerHTML = val;
        if (val) {
          const child = new MockElement();
          this.children = [child];
        }
      }
      get firstElementChild(): MockElement | null {
        return this.children[0] ?? null;
      }
      style: Record<string, string> = { display: "" };
      classList = {
        contains: (c: string) => this.className.includes(c),
        add: (c: string) => {
          this.className += ` ${c}`;
        },
        remove: (c: string) => {
          this.className = this.className.replace(c, "").trim();
        },
        toggle: (c: string, force?: boolean) => {
          const has = this.className.includes(c);
          const next = force !== undefined ? force : !has;
          if (next && !has) this.classList.add(c);
          if (!next && has) this.classList.remove(c);
          return next;
        },
      };
      children: MockElement[] = [];
      appendChild(child: MockElement) {
        this.children.push(child);
        return child;
      }
      querySelector(sel: string): MockElement | null {
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          if (this.className.includes(cls)) return this;
          for (const child of this.children) {
            const found = child.querySelector(sel);
            if (found) return found;
          }
        }
        return null;
      }
      querySelectorAll(sel: string): MockElement[] {
        const results: MockElement[] = [];
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          if (this.className.includes(cls)) results.push(this);
          for (const child of this.children) {
            results.push(...child.querySelectorAll(sel));
          }
        }
        return results;
      }
      addEventListener() {}
      focus() {}
      select() {}
    }

    if (typeof globalThis.document === "undefined") {
      (globalThis as unknown as { document: unknown }).document = {
        createElement: () => new MockElement(),
      };
    }

    try {
      const { createLiquidSearchPanel } = await import("../../src/wysiwyg/search-panel.ts");
      const state = createState("Hello Search");
      const mockView = {
        state,
        dispatch: () => {},
        focus: () => {},
      } as unknown as EditorView;

      const panel = createLiquidSearchPanel(mockView);
      expect(panel.dom).toBeDefined();
      expect(panel.dom.classList.contains("cm-search-liquid-panel")).toBe(true);

      const searchInput = panel.dom.querySelector(".cm-search-input");
      expect(searchInput).not.toBeNull();

      const replaceRow = panel.dom.querySelector(".cm-replace-row");
      expect(replaceRow).not.toBeNull();

      const filterButtons = panel.dom.querySelectorAll(".cm-search-filter-btn");
      expect(filterButtons.length).toBe(3); // Aa, \b, .*
    } finally {
      globalThis.document = originalDocument;
    }
  });
});
