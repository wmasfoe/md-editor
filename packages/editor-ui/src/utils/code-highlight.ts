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
  type Highlighter
} from "shiki";

export const codeHighlightTheme = "github-light" satisfies BundledTheme;

export interface CodeHighlightToken {
  readonly from: number;
  readonly to: number;
  readonly color: string;
  readonly fontStyle?: number;
}

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
  mdx: "mdx",
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
  yaml: "yaml"
};

const codeHighlightPluginKey = new PluginKey<DecorationSet>("md-editor-code-highlight");
const codeHighlightRefreshMeta = "md-editor-code-highlight-refresh";
const tokenCache = new Map<string, readonly CodeHighlightToken[]>();
const pendingHighlights = new Map<string, Promise<void>>();

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
        }
      },
      props: {
        decorations(state) {
          return codeHighlightPluginKey.getState(state);
        }
      },
      view(view) {
        scheduleMissingHighlights(view);

        return {
          update(updatedView, previousState) {
            if (updatedView.state.doc !== previousState.doc) {
              scheduleMissingHighlights(updatedView);
            }
          }
        };
      }
    })
);

export async function tokenizeCodeForHighlighting(
  code: string,
  language?: string | null
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
          class: "md-code-token md-code-token-shiki",
          style: createTokenStyle(token)
        })
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
  language: BundledLanguage
): Promise<readonly CodeHighlightToken[]> {
  const highlighter = await getHighlighter();
  const result = highlighter.codeToTokens(code, {
    lang: language,
    theme: codeHighlightTheme
  });

  const tokens: CodeHighlightToken[] = [];
  for (const line of result.tokens) {
    for (const token of line) {
      if (!token.color || token.content.length === 0) {
        continue;
      }
      tokens.push({
        from: token.offset,
        to: token.offset + token.content.length,
        color: token.color,
        fontStyle: token.fontStyle
      });
    }
  }

  return tokens;
}

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= getSingletonHighlighter({
    themes: [codeHighlightTheme],
    langs: Object.keys(bundledLanguages) as BundledLanguage[]
  });

  return highlighterPromise;
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

function createTokenStyle(token: CodeHighlightToken): string {
  const styles = [`color: ${token.color}`];
  if (token.fontStyle && (token.fontStyle & 1) !== 0) {
    styles.push("font-style: italic");
  }
  if (token.fontStyle && (token.fontStyle & 2) !== 0) {
    styles.push("font-weight: 650");
  }
  if (token.fontStyle && (token.fontStyle & 4) !== 0) {
    styles.push("text-decoration: underline");
  }

  return styles.join("; ");
}

export function createCodeHighlightRefreshTransaction(state: EditorState): Transaction {
  return state.tr.setMeta(codeHighlightRefreshMeta, true);
}
