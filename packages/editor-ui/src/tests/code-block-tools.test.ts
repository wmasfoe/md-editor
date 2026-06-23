import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  createCodeBlockToolsProsePlugin,
  getLanguageSuggestions,
  normalizeCodeLanguage,
  planCodeBlockTabIndent
} from "../utils/code-block-tools";

describe("code block tools", () => {
  it("plans tab insertion only inside code blocks", () => {
    expect(planCodeBlockTabIndent("paragraph", "", 4, 4)).toBeNull();
    expect(planCodeBlockTabIndent("code_block", "", 4, 4)).toEqual({
      from: 4,
      to: 4,
      text: "  "
    });
  });

  it("plans selected line indentation and outdentation", () => {
    expect(planCodeBlockTabIndent("code_block", "a\nb", 10, 13)).toEqual({
      from: 10,
      to: 13,
      text: "  a\n  b"
    });
    expect(planCodeBlockTabIndent("code_block", "  a\n\tb\nc", 10, 19, true)).toEqual({
      from: 10,
      to: 19,
      text: "a\nb\nc"
    });
  });

  it("suggests languages fuzzily while preserving free-form input elsewhere", () => {
    expect(getLanguageSuggestions("ts")).toContain("typescript");
    expect(getLanguageSuggestions("jx")).toContain("jsx");
    expect(getLanguageSuggestions("totally-custom-language")).toEqual([]);
  });

  it("normalizes free-form language labels before writing fenced info", () => {
    expect(normalizeCodeLanguage(" Type Script ")).toBe("Type-Script");
    expect(normalizeCodeLanguage("`custom lang`")).toBe("custom-lang");
    expect(normalizeCodeLanguage(null)).toBe("");
  });

  it("leaves Mod-a to the default ProseMirror full-document keymap", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "text*", group: "block" },
        code_block: { content: "text*", group: "block", code: true },
        text: {}
      }
    });
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.code_block.create(null, schema.text("const value = 1;")),
      schema.nodes.paragraph.create(null, schema.text("after"))
    ]);
    const view = {
      state: EditorState.create({ doc }),
      dispatch: () => {
        throw new Error("code block tools must not dispatch for Mod-a");
      }
    } as unknown as EditorView;
    const event = {
      key: "a",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false
    } as KeyboardEvent;

    const plugin = createCodeBlockToolsProsePlugin();

    expect(plugin.props.handleKeyDown?.call(plugin, view, event)).toBe(false);
  });
});
