import type { DocumentMetrics } from "@md-editor/editor";
import { t } from "@md-editor/i18n";

export type DocumentMetricKind = "words" | "lines" | "characters";

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
