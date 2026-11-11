import type { SourceRange } from "@md-editor/plugin-sdk/syntax";

export function sourceRangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return left.from < right.to && right.from < left.to;
}

export function sourceRangeContains(range: SourceRange, position: number): boolean {
  return position >= range.from && position <= range.to;
}

export function fingerprintSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function freezeSourceRange(range: SourceRange): SourceRange {
  return Object.freeze({ from: range.from, to: range.to });
}
