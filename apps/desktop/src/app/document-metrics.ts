import { t } from "@md-editor/i18n";

export type DocumentMetricKind = "words" | "lines" | "characters";

export interface DocumentMetrics {
  readonly words: number;
  readonly lines: number;
  readonly characters: number;
}

export function calculateDocumentMetrics(markdown: string): DocumentMetrics {
  return {
    words: countWords(markdown),
    lines: countLines(markdown),
    characters: Array.from(markdown).length,
  };
}

export function getDocumentMetricLabel(kind: DocumentMetricKind, metrics: DocumentMetrics): string {
  switch (kind) {
    case "words":
      return t("editor.metrics.wordsCount", { count: metrics.words });
    case "lines":
      return t("editor.metrics.linesCount", { count: metrics.lines });
    case "characters":
      return t("editor.metrics.charactersCount", { count: metrics.characters });
  }
}

function countWords(markdown: string): number {
  const tokens = markdown.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return tokens?.length ?? 0;
}

function countLines(markdown: string): number {
  if (!markdown) {
    return 0;
  }

  return markdown.split(/\r\n|\r|\n/u).length;
}
