import { describe, expect, it } from "vitest";
import { computeLineDiff, materializeLineDiff } from "../../../src/components/history/line-diff.ts";

const diff = (
  current: string,
  snapshot: string,
  ranges: { kind: "added" | "removed" | "unchanged"; currentLen: number; snapshotLen: number }[],
) => materializeLineDiff(current, snapshot, ranges);

describe("computeLineDiff", () => {
  it("keeps precise browser fallback context between separate edits", () => {
    const current = "A\nold\nB\nwork\nZ";
    const snapshot = "A\nnew\nB\nrestored\nZ";
    const result = computeLineDiff(current, snapshot);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(2);
    expect(result.lines.map((line) => [line.type, line.text])).toEqual([
      ["unchanged", "A"],
      ["removed", "old"],
      ["added", "new"],
      ["unchanged", "B"],
      ["removed", "work"],
      ["added", "restored"],
      ["unchanged", "Z"],
    ]);
  });

  it("returns zero diff for identical contents", () => {
    const text = "# Heading\nLine 1\nLine 2";
    const result = diff(text, text, [{ kind: "unchanged", currentLen: 3, snapshotLen: 3 }]);

    expect(result.hasChanges).toBe(false);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.charDelta).toBe(0);
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((l) => l.type === "unchanged")).toBe(true);
  });

  it("detects added lines when snapshot has extra content", () => {
    const current = "# Heading\nLine 1";
    const snapshot = "# Heading\nLine 1\nRestored Line 2";
    const result = diff(current, snapshot, [
      { kind: "unchanged", currentLen: 2, snapshotLen: 2 },
      { kind: "added", currentLen: 0, snapshotLen: 1 },
    ]);

    expect(result.hasChanges).toBe(true);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    const addedLine = result.lines.find((l) => l.type === "added");
    expect(addedLine?.text).toBe("Restored Line 2");
    expect(addedLine?.snapshotLineNumber).toBe(3);
  });

  it("detects removed lines when current has modifications not in snapshot", () => {
    const current = "# Heading\nDraft WIP Line\nLine 2";
    const snapshot = "# Heading\nLine 2";
    const result = diff(current, snapshot, [
      { kind: "unchanged", currentLen: 1, snapshotLen: 1 },
      { kind: "removed", currentLen: 1, snapshotLen: 0 },
      { kind: "unchanged", currentLen: 1, snapshotLen: 1 },
    ]);

    expect(result.hasChanges).toBe(true);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(1);
    const removedLine = result.lines.find((l) => l.type === "removed");
    expect(removedLine?.text).toBe("Draft WIP Line");
    expect(removedLine?.currentLineNumber).toBe(2);
  });

  it("handles complex multi-line edits with common prefix and suffix", () => {
    const current = "A\nB\nModified In Current\nC\nD";
    const snapshot = "A\nB\nOriginal In Snapshot\nC\nD";
    const result = diff(current, snapshot, [
      { kind: "unchanged", currentLen: 2, snapshotLen: 2 },
      { kind: "removed", currentLen: 1, snapshotLen: 0 },
      { kind: "added", currentLen: 0, snapshotLen: 1 },
      { kind: "unchanged", currentLen: 2, snapshotLen: 2 },
    ]);

    expect(result.hasChanges).toBe(true);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.lines.filter((l) => l.type === "unchanged")).toHaveLength(4);
  });

  it("handles empty texts gracefully", () => {
    const emptyResult = diff("", "", []);
    expect(emptyResult.hasChanges).toBe(false);
    expect(emptyResult.lines).toHaveLength(0);

    const fromEmpty = diff("", "New text", [{ kind: "added", currentLen: 0, snapshotLen: 1 }]);
    expect(fromEmpty.hasChanges).toBe(true);
    expect(fromEmpty.additions).toBe(1);
  });
});
