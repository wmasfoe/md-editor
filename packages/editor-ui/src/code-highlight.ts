import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export type CodeTokenKind = "keyword" | "string" | "comment" | "number" | "tag";

export interface CodeHighlightToken {
  readonly from: number;
  readonly to: number;
  readonly kind: CodeTokenKind;
}

const keywordGroups: Readonly<Record<string, readonly string[]>> = {
  js: [
    "await",
    "async",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "let",
    "new",
    "return",
    "switch",
    "throw",
    "try",
    "typeof",
    "var",
    "while",
    "yield"
  ],
  json: ["false", "null", "true"],
  css: ["important", "inherit", "initial", "unset"],
  html: [],
  markdown: [],
  shell: ["case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "then", "while"],
  yaml: ["false", "null", "true"]
};

const languageAliases: Readonly<Record<string, keyof typeof keywordGroups>> = {
  bash: "shell",
  cjs: "js",
  css: "css",
  html: "html",
  htm: "html",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "js",
  markdown: "markdown",
  md: "markdown",
  mjs: "js",
  sh: "shell",
  shell: "shell",
  ts: "js",
  tsx: "js",
  typescript: "js",
  yml: "yaml",
  yaml: "yaml"
};

const codeHighlightPluginKey = new PluginKey<DecorationSet>("md-editor-code-highlight");

export const codeHighlightPlugin = $prose(
  () =>
    new Plugin({
      key: codeHighlightPluginKey,
      state: {
        init: (_, state) => buildCodeDecorations(state.doc),
        apply(transaction, decorations, _, nextState) {
          return transaction.docChanged ? buildCodeDecorations(nextState.doc) : decorations;
        }
      },
      props: {
        decorations(state) {
          return codeHighlightPluginKey.getState(state);
        }
      }
    })
);

export function tokenizeCodeForHighlighting(
  code: string,
  language?: string | null
): readonly CodeHighlightToken[] {
  const normalized = normalizeLanguage(language);
  const keywords = normalized ? keywordGroups[normalized] : keywordGroups.js;
  const keywordPattern = keywords.length > 0 ? `\\b(?:${keywords.map(escapeRegExp).join("|")})\\b` : "";
  const tagPattern = normalized === "html" || normalized === "markdown" ? "</?[A-Za-z][\\w:-]*\\b|>" : "";
  const patterns = [
    "(?:\\/\\*[\\s\\S]*?\\*\\/)",
    "(?://[^\\n]*)",
    "(?:#[^\\n]*)",
    "(?:<!--(?:.|\\n)*?-->)",
    "(?:`(?:\\\\.|[^`])*`)",
    "(?:\"(?:\\\\.|[^\"\\n])*\")",
    "(?:'(?:\\\\.|[^'\\n])*')",
    "\\b\\d+(?:\\.\\d+)?\\b",
    keywordPattern,
    tagPattern
  ].filter(Boolean);
  const scanner = new RegExp(patterns.join("|"), "g");
  const tokens: CodeHighlightToken[] = [];

  for (const match of code.matchAll(scanner)) {
    const value = match[0];
    const from = match.index ?? 0;
    const kind = classifyToken(value, keywords, normalized);
    if (kind) {
      tokens.push({ from, to: from + value.length, kind });
    }
  }

  return tokens;
}

function buildCodeDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (node.type.name !== "code_block") {
      return true;
    }

    const language = typeof node.attrs.language === "string" ? node.attrs.language : null;
    const codeStart = position + 1;

    // Decorations are mapped to document positions, so syntax colors disappear
    // and recalculate with normal ProseMirror transactions instead of mutating
    // the editable DOM by hand.
    for (const token of tokenizeCodeForHighlighting(node.textContent, language)) {
      decorations.push(
        Decoration.inline(codeStart + token.from, codeStart + token.to, {
          class: `md-code-token md-code-token-${token.kind}`
        })
      );
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function classifyToken(
  value: string,
  keywords: readonly string[],
  language: keyof typeof keywordGroups | null
): CodeTokenKind | null {
  if (
    value.startsWith("//") ||
    value.startsWith("/*") ||
    value.startsWith("#") ||
    value.startsWith("<!--")
  ) {
    return "comment";
  }
  if (value.startsWith("\"") || value.startsWith("'") || value.startsWith("`")) {
    return "string";
  }
  if (/^\d/u.test(value)) {
    return "number";
  }
  if ((language === "html" || language === "markdown") && /^<\/?|^>$/u.test(value)) {
    return "tag";
  }
  return keywords.includes(value) ? "keyword" : null;
}

function normalizeLanguage(language?: string | null): keyof typeof keywordGroups | null {
  if (!language) {
    return null;
  }

  const key = language.trim().toLowerCase();
  return languageAliases[key] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
