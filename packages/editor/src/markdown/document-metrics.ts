import type { Text } from "@codemirror/state";

export interface DocumentMetrics {
  readonly words: number;
  readonly lines: number;
  readonly characters: number;
}

const subtreeMetrics = new WeakMap<Text, DocumentMetrics>();

/** Count Han characters individually and preserve apostrophes and hyphens inside words. */
export function calculateDocumentMetrics(markdown: string): DocumentMetrics {
  const tokens = /[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  let words = 0;
  while (tokens.test(markdown)) words++;

  // JS strings use UTF-16. Count a surrogate pair as one character and CRLF as one break.
  const pairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  let characters = markdown.length;
  while (pairs.test(markdown)) characters--;
  const breaks = /\r\n|[\r\n]/g;
  let lines = markdown.length ? 1 : 0;
  while (breaks.test(markdown)) lines++;
  return { words, lines, characters };
}

/** CM6 shares immutable line subtrees across edits. Only rescan leaves on changed paths. */
export function measureEditorText(doc: Text): DocumentMetrics {
  const cached = subtreeMetrics.get(doc);
  if (cached) return cached;

  let result: DocumentMetrics;
  if (doc.children) {
    // One newline separates each pair of sibling subtrees, including blank lines.
    let characters = doc.children.length - 1;
    let words = 0;
    for (const child of doc.children) {
      const part = measureEditorText(child);
      words += part.words;
      characters += part.characters;
    }
    result = { words, lines: doc.lines, characters };
  } else {
    result = calculateDocumentMetrics(doc.toString());
  }
  Object.freeze(result);
  subtreeMetrics.set(doc, result);
  return result;
}
