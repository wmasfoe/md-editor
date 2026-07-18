import type { EditorState } from "@codemirror/state";
import type { MarkdownRangeRecord } from "../markdown/range-types.ts";
import { fingerprintSource } from "../markdown/range-types.ts";

export type DefaultAtomRecord = MarkdownRangeRecord & {
  readonly renderPolicy: "source-only-atom";
  readonly editPolicy: "source-mode-only";
};

export function isDefaultAtomRecord(record: MarkdownRangeRecord): record is DefaultAtomRecord {
  return (
    record.parserCoverage === "complete" &&
    record.renderPolicy === "source-only-atom" &&
    record.editPolicy === "source-mode-only"
  );
}

export function hasCurrentSourceFingerprint(
  record: MarkdownRangeRecord,
  state: EditorState,
): boolean {
  return (
    fingerprintSource(state.sliceDoc(record.fullRange.from, record.fullRange.to)) ===
    record.sourceFingerprint
  );
}
