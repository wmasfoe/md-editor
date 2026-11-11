import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { highlightingFor, LanguageDescription, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { WysiwygDiagnostics } from "../../src/diagnostics.ts";
import {
  CODE_BLOCK_LANGUAGES,
  codeBlockTokenHighlighting,
  createMarkdownLanguageSupport,
  findCodeBlockLanguage,
  observeCodeBlockLanguageLoads,
} from "../../src/markdown/code-languages.ts";

describe("code-block language registry", () => {
  it.each([
    ["bash", "Bash"],
    ["c#", "C#"],
    ["cxx", "C++"],
    ["golang", "Go"],
    ["js", "JavaScript"],
    ["jsx", "JSX"],
    ["md", "Markdown"],
    ["py", "Python"],
    ["rb", "Ruby"],
    ["rs", "Rust"],
    ["sh", "Shell"],
    ["ts", "TypeScript"],
    ["tsx", "TSX"],
    ["yml", "YAML"],
  ])("resolves %s to %s without loading its parser", (token, expectedName) => {
    const match = findCodeBlockLanguage(token);

    expect(match?.name).toBe(expectedName);
    expect(match?.support).toBeUndefined();
  });

  it("matches names case-insensitively and leaves unknown tokens unresolved without fuzzy matching", () => {
    expect(findCodeBlockLanguage(" TypeScript ")?.name).toBe("TypeScript");
    expect(findCodeBlockLanguage("unknown-language")).toBeNull();
    expect(findCodeBlockLanguage("typescript-extra")).toBeNull();
    expect(findCodeBlockLanguage("mdx")).toBeNull();
    expect(findCodeBlockLanguage("text")).toBeNull();
    expect(findCodeBlockLanguage("  ")).toBeNull();
  });

  it("keeps the historical fixed menu explicit", () => {
    expect(CODE_BLOCK_LANGUAGES.map(({ name }) => name)).toEqual([
      "Bash",
      "C",
      "C#",
      "C++",
      "CSS",
      "Go",
      "HTML",
      "Java",
      "JavaScript",
      "JSON",
      "JSX",
      "Markdown",
      "Python",
      "Ruby",
      "Rust",
      "Shell",
      "Swift",
      "TypeScript",
      "TSX",
      "YAML",
    ]);
  });

  it("creates Markdown support with the curated registry and theme-backed token classes", () => {
    const keywordState = EditorState.create({
      extensions: [createMarkdownLanguageSupport({ addKeymap: false }), codeBlockTokenHighlighting],
    });

    expect(highlightingFor(keywordState, [tags.keyword])).toBe("tok-keyword");
    expect(highlightingFor(keywordState, [tags.string])).toBe("tok-string");
    expect(highlightingFor(keywordState, [tags.comment])).toBe("tok-comment");
    expect(highlightingFor(keywordState, [tags.number])).toBe("tok-number");
    expect(highlightingFor(keywordState, [tags.variableName])).toBe("tok-variableName");
  });

  it("uses exact CM native codeLanguages resolver for known, alias, pending, and unknown tokens", () => {
    const loadCalls: string[] = [];
    const known = LanguageDescription.of({
      name: "NativeKnown",
      alias: ["known"],
      load: () => {
        loadCalls.push("known");
        return new Promise<never>(() => undefined);
      },
    });
    const alias = LanguageDescription.of({
      name: "NativeAlias",
      alias: ["alias"],
      load: () => {
        loadCalls.push("alias");
        return new Promise<never>(() => undefined);
      },
    });
    const state = EditorState.create({
      doc: ["```known meta=1", "value", "```", "", "```alias", "value", "```"].join("\n"),
      extensions: [
        markdown({
          codeLanguages: (info) =>
            [known, alias].find((language) => language.alias.includes(info.toLowerCase())) ?? null,
          addKeymap: false,
        }),
      ],
    });

    expect(loadCalls).toEqual(["known", "alias"]);
    expect(state.doc.toString()).toContain("```known meta=1");

    loadCalls.length = 0;
    const unknown = EditorState.create({
      doc: ["```custom-language", "value", "```"].join("\n"),
      extensions: [
        markdown({
          codeLanguages: (info) =>
            [known, alias].find((language) => language.alias.includes(info.toLowerCase())) ?? null,
          addKeymap: false,
        }),
      ],
    });

    expect(loadCalls).toEqual([]);
    expect(unknown.doc.toString()).toBe("```custom-language\nvalue\n```");
  });

  it("mounts parser and highlight output for the latest rapid info-token change", () => {
    const js = LanguageDescription.of({
      name: "JavaScript",
      alias: ["js"],
      support: javascript(),
    });
    const cssLanguage = LanguageDescription.of({
      name: "CSS",
      alias: ["css"],
      support: css(),
    });
    const codeLanguages = (info: string): LanguageDescription | null =>
      [js, cssLanguage].find((language) => language.alias.includes(info.toLowerCase())) ?? null;
    let state = EditorState.create({
      doc: ["```js", "const value = 1;", "```"].join("\n"),
      extensions: [markdown({ codeLanguages, addKeymap: false })],
    });

    state = state.update({
      changes: [
        { from: 3, to: 5, insert: "css" },
        { from: 6, to: 22, insert: ".value { color: red; }" },
      ],
    }).state;
    const reparsedFinalState = EditorState.create({
      doc: state.doc.toString(),
      extensions: [markdown({ codeLanguages, addKeymap: false })],
    });
    const cssPropertyPosition = reparsedFinalState.doc.toString().indexOf("color");
    const highlightSpans: Array<{ readonly className: string; readonly text: string }> = [];
    highlightTree(syntaxTree(reparsedFinalState), classHighlighter, (from, to, className) => {
      highlightSpans.push({ className, text: reparsedFinalState.doc.sliceString(from, to) });
    });

    expect(state.doc.toString()).toBe("```css\n.value { color: red; }\n```");
    expect(syntaxTree(reparsedFinalState).resolveInner(cssPropertyPosition, 1).name).toBe(
      "PropertyName",
    );
    expect(highlightSpans).toContainEqual({ className: "tok-propertyName", text: "color" });
    expect(highlightSpans).toContainEqual({ className: "tok-className", text: "value" });
  });

  it("keeps rapid pending info-token changes source-safe while CM native loading races", () => {
    const loadCalls: string[] = [];
    const first = LanguageDescription.of({
      name: "First",
      alias: ["first"],
      load: () => {
        loadCalls.push("first");
        return new Promise<never>(() => undefined);
      },
    });
    const second = LanguageDescription.of({
      name: "Second",
      alias: ["second"],
      load: () => {
        loadCalls.push("second");
        return new Promise<never>(() => undefined);
      },
    });
    let state = EditorState.create({
      doc: ["```first", "value", "```"].join("\n"),
      extensions: [
        markdown({
          codeLanguages: (info) =>
            [first, second].find((language) => language.alias.includes(info.toLowerCase())) ?? null,
          addKeymap: false,
        }),
      ],
    });

    state = state.update({ changes: { from: 3, to: 8, insert: "second" } }).state;

    expect(loadCalls).toEqual(["first", "second"]);
    expect(state.doc.toString()).toBe("```second\nvalue\n```");
  });

  it("leaves source intact when a matched native language loader fails", async () => {
    const failure = new Error("native parser unavailable");
    const failing = LanguageDescription.of({
      name: "Failing",
      alias: ["failing"],
      load: () => Promise.reject(failure),
    });
    const state = EditorState.create({
      doc: ["```failing", "value", "```"].join("\n"),
      extensions: [
        markdown({
          codeLanguages: (info) => (failing.alias.includes(info.toLowerCase()) ? failing : null),
          addKeymap: false,
        }),
      ],
    });

    await expect(failing.load()).rejects.toBe(failure);
    expect(state.doc.toString()).toBe("```failing\nvalue\n```");
  });

  it("M2C-P04 records only actual native loader attempts, successes, and failures", async () => {
    const diagnostics = new WysiwygDiagnostics();
    const successful = LanguageDescription.of({
      name: "Successful",
      alias: ["successful"],
      load: async () => markdown(),
    });
    const failure = new Error("loader failed");
    const failing = LanguageDescription.of({
      name: "Failing",
      alias: ["failing"],
      load: () => Promise.reject(failure),
    });
    const observed = observeCodeBlockLanguageLoads([successful, failing], diagnostics);

    expect(findCodeBlockLanguage("unknown", observed)).toBeNull();
    expect(diagnostics.snapshot()).toMatchObject({
      languageLoadAttemptCount: 0,
      languageLoadSuccessCount: 0,
      languageLoadFailureCount: 0,
    });

    await expect(observed[0].load()).resolves.toBeDefined();
    await expect(observed[0].load()).resolves.toBeDefined();
    await expect(observed[1].load()).rejects.toBe(failure);
    await expect(observed[1].load()).rejects.toBe(failure);
    expect(diagnostics.snapshot()).toMatchObject({
      languageLoadAttemptCount: 3,
      languageLoadSuccessCount: 1,
      languageLoadFailureCount: 2,
    });
  });
});
