import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import {
  bundledLanguages,
  getSingletonHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from "shiki";

export const codeHighlightTheme = "github-light" satisfies BundledTheme;

export interface CodeHighlightToken {
  readonly from: number;
  readonly to: number;
  readonly kind: CodeHighlightTokenKind;
  readonly fontStyle?: number;
}

export type CodeHighlightTokenKind =
  "attribute" | "comment" | "keyword" | "number" | "string" | "tag" | "variable";

const languageAliases: Readonly<Record<string, BundledLanguage>> = {
  bash: "bash",
  c: "c",
  "c++": "cpp",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  css: "css",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  gql: "graphql",
  graphql: "graphql",
  html: "html",
  htm: "html",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mdx: "html",
  mjs: "javascript",
  py: "python",
  python: "python",
  rs: "rust",
  rust: "rust",
  sh: "shellscript",
  shell: "shellscript",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
};

const codeHighlightPluginKey = new PluginKey<DecorationSet>("md-editor-code-highlight");
const codeHighlightRefreshMeta = "md-editor-code-highlight-refresh";
const tokenCache = new Map<string, readonly CodeHighlightToken[]>();
const pendingHighlights = new Map<string, Promise<void>>();
const pendingLanguageLoads = new Map<BundledLanguage, Promise<void>>();

let highlighterPromise: Promise<Highlighter> | null = null;

export const codeHighlightPlugin = $prose(
  () =>
    new Plugin({
      key: codeHighlightPluginKey,
      state: {
        init: (_, state) => buildCodeDecorations(state.doc),
        apply(transaction, decorations, _, nextState) {
          if (transaction.docChanged || transaction.getMeta(codeHighlightRefreshMeta)) {
            return buildCodeDecorations(nextState.doc);
          }

          return decorations.map(transaction.mapping, transaction.doc);
        },
      },
      props: {
        decorations(state) {
          return codeHighlightPluginKey.getState(state);
        },
      },
      view(view) {
        scheduleMissingHighlights(view);

        return {
          update(updatedView, previousState) {
            if (updatedView.state.doc !== previousState.doc) {
              scheduleMissingHighlights(updatedView);
            }
          },
        };
      },
    }),
);

export async function tokenizeCodeForHighlighting(
  code: string,
  language?: string | null,
): Promise<readonly CodeHighlightToken[]> {
  const normalized = normalizeLanguage(language);
  if (!normalized || code.length === 0) {
    return [];
  }

  const cacheKey = createCacheKey(code, normalized);
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tokens = await highlightWithShiki(code, normalized);
  tokenCache.set(cacheKey, tokens);
  return tokens;
}

export function normalizeCodeHighlightLanguage(language?: string | null): BundledLanguage | null {
  return normalizeLanguage(language);
}

function buildCodeDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (node.type.name !== "code_block") {
      return true;
    }

    const language = typeof node.attrs.language === "string" ? node.attrs.language : null;
    const normalized = normalizeLanguage(language);
    if (!normalized) {
      return false;
    }

    const tokens = tokenCache.get(createCacheKey(node.textContent, normalized));
    if (!tokens) {
      return false;
    }

    const codeStart = position + 1;
    for (const token of tokens) {
      decorations.push(
        Decoration.inline(codeStart + token.from, codeStart + token.to, {
          class: createTokenClassName(token),
        }),
      );
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function scheduleMissingHighlights(view: EditorView): void {
  const jobs: Array<Promise<void>> = [];

  view.state.doc.descendants((node) => {
    if (node.type.name !== "code_block") {
      return true;
    }

    const language = typeof node.attrs.language === "string" ? node.attrs.language : null;
    const normalized = normalizeLanguage(language);
    if (!normalized) {
      return false;
    }

    const code = node.textContent;
    const cacheKey = createCacheKey(code, normalized);
    if (tokenCache.has(cacheKey)) {
      return false;
    }

    let job = pendingHighlights.get(cacheKey);
    if (!job) {
      job = highlightWithShiki(code, normalized)
        .then((tokens) => {
          tokenCache.set(cacheKey, tokens);
        })
        .catch(() => {
          tokenCache.set(cacheKey, []);
        })
        .finally(() => {
          pendingHighlights.delete(cacheKey);
        });
      pendingHighlights.set(cacheKey, job);
    }
    jobs.push(job);
    return false;
  });

  if (jobs.length === 0) {
    return;
  }

  void Promise.allSettled(jobs).then(() => {
    if (view.isDestroyed) {
      return;
    }
    dispatchHighlightRefresh(view);
  });
}

function dispatchHighlightRefresh(view: EditorView): void {
  const transaction = view.state.tr.setMeta(codeHighlightRefreshMeta, true);
  view.dispatch(transaction);
}

async function highlightWithShiki(
  code: string,
  language: BundledLanguage,
): Promise<readonly CodeHighlightToken[]> {
  const highlighter = await getHighlighter();
  await ensureLanguageLoaded(highlighter, language);
  const result = highlighter.codeToTokens(code, {
    lang: language,
    theme: codeHighlightTheme,
  });

  const tokens: CodeHighlightToken[] = [];
  for (const line of result.tokens) {
    for (const token of line) {
      if (!token.color || token.content.length === 0) {
        continue;
      }
      const kind = classifyToken(token.color, token.content);
      if (!kind) {
        continue;
      }
      tokens.push({
        from: token.offset,
        to: token.offset + token.content.length,
        kind,
        fontStyle: token.fontStyle,
      });
    }
  }

  return tokens;
}

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= getSingletonHighlighter({
    themes: [codeHighlightTheme],
    langs: [],
  });

  return highlighterPromise;
}

async function ensureLanguageLoaded(
  highlighter: Highlighter,
  language: BundledLanguage,
): Promise<void> {
  if (highlighter.getLoadedLanguages().includes(language)) {
    return;
  }

  let load = pendingLanguageLoads.get(language);
  if (!load) {
    load = highlighter.loadLanguage(language).finally(() => {
      pendingLanguageLoads.delete(language);
    });
    pendingLanguageLoads.set(language, load);
  }

  await load;
}

function normalizeLanguage(language?: string | null): BundledLanguage | null {
  if (!language) {
    return null;
  }

  const key = language.trim().toLowerCase().split(/\s+/u)[0];
  if (!key) {
    return null;
  }

  const normalized = languageAliases[key] ?? (key as BundledLanguage);
  return normalized in bundledLanguages ? normalized : null;
}

function createCacheKey(code: string, language: BundledLanguage): string {
  return `${codeHighlightTheme}\u0000${language}\u0000${code}`;
}

function classifyToken(color: string, content: string): CodeHighlightTokenKind | null {
  const normalizedColor = color.toLowerCase();
  const trimmed = content.trim();

  switch (normalizedColor) {
    case "#24292e":
      return null;
    case "#d73a49":
      return "keyword";
    case "#032f62":
      return "string";
    case "#6a737d":
      return "comment";
    case "#b31d28":
      return "tag";
    case "#6f42c1":
      return "attribute";
    case "#005cc5":
      return /^(?:0x[\da-f]+|\d|true\b|false\b|null\b)/iu.test(trimmed) ? "number" : "variable";
    default:
      return "variable";
  }
}

function createTokenClassName(token: CodeHighlightToken): string {
  const classNames = ["md-code-token", `md-code-token-${token.kind}`];
  if (token.fontStyle && (token.fontStyle & 1) !== 0) {
    classNames.push("md-code-token-italic");
  }
  if (token.fontStyle && (token.fontStyle & 2) !== 0) {
    classNames.push("md-code-token-bold");
  }
  if (token.fontStyle && (token.fontStyle & 4) !== 0) {
    classNames.push("md-code-token-underline");
  }

  return classNames.join(" ");
}

export function createCodeHighlightRefreshTransaction(state: EditorState): Transaction {
  return state.tr.setMeta(codeHighlightRefreshMeta, true);
}
