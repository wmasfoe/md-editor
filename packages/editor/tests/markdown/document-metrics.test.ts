import { Text } from "@codemirror/state";
import { expect, it, vi } from "vitest";
import {
  calculateDocumentMetrics,
  measureEditorText,
} from "../../src/markdown/document-metrics.ts";

it("reuses unchanged subtrees and counts separators, Unicode and empty documents", () => {
  const doc = Text.of(
    Array.from({ length: 2000 }, (_, i) => (i % 3 === 0 ? "" : "作者 🖊️ co-author")),
  );
  expect(measureEditorText(doc)).toEqual(calculateDocumentMetrics(doc.toString()));
  const unchanged = doc.children!.at(-1)!;
  const scan = vi.spyOn(unchanged, "toString");
  try {
    const next = doc.replace(1, 3, Text.of(["", "𠮷", ""]));
    expect(measureEditorText(next)).toEqual(calculateDocumentMetrics(next.toString()));
    expect(scan).not.toHaveBeenCalled();
    expect(measureEditorText(Text.empty)).toEqual({ words: 0, characters: 0, lines: 0 });
    expect(calculateDocumentMetrics("a\r\nb\rc")).toEqual({ words: 3, characters: 6, lines: 3 });
  } finally {
    scan.mockRestore();
  }
});
