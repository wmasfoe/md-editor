/** Compact ranges returned by the native Patience line diff command. */
export interface DiffRange {
  readonly kind: "added" | "removed" | "unchanged";
  readonly currentLen: number;
  readonly snapshotLen: number;
}

export interface DiffLine {
  readonly type: DiffRange["kind"];
  readonly currentLineNumber?: number;
  readonly snapshotLineNumber?: number;
  readonly text: string;
}

export interface DiffResult {
  readonly lines: readonly DiffLine[];
  readonly additions: number;
  readonly deletions: number;
  readonly charDelta: number;
  readonly hasChanges: boolean;
}

/** Expand compact native ranges using the original texts, without shipping line bodies through IPC. */
export function materializeLineDiff(
  currentText: string,
  snapshotText: string,
  ranges: readonly DiffRange[],
): DiffResult {
  const current = currentText ? currentText.split(/\r?\n/) : [];
  const snapshot = snapshotText ? snapshotText.split(/\r?\n/) : [];
  const lines: DiffLine[] = [];
  let currentIndex = 0;
  let snapshotIndex = 0;
  let additions = 0;
  let deletions = 0;
  for (const range of ranges) {
    for (let i = 0; i < range.currentLen || i < range.snapshotLen; i++) {
      if (range.kind === "unchanged") {
        lines.push({
          type: range.kind,
          currentLineNumber: currentIndex + 1,
          snapshotLineNumber: snapshotIndex + 1,
          text: current[currentIndex],
        });
        currentIndex++;
        snapshotIndex++;
      } else if (range.kind === "removed") {
        lines.push({
          type: range.kind,
          currentLineNumber: currentIndex + 1,
          text: current[currentIndex++],
        });
        deletions++;
      } else {
        lines.push({
          type: range.kind,
          snapshotLineNumber: snapshotIndex + 1,
          text: snapshot[snapshotIndex++],
        });
        additions++;
      }
    }
  }
  return {
    lines,
    additions,
    deletions,
    charDelta: snapshotText.length - currentText.length,
    hasChanges: additions > 0 || deletions > 0,
  };
}

/** Keep browser previews and Vite E2E output as precise as the historical native-independent diff. */
export function computeLineDiff(currentText: string, snapshotText: string): DiffResult {
  const charDelta = snapshotText.length - currentText.length;
  const aLines = currentText ? currentText.split(/\r?\n/) : [];
  const bLines = snapshotText ? snapshotText.split(/\r?\n/) : [];
  if (currentText === snapshotText) {
    return {
      lines: aLines.map((text, index) => ({
        type: "unchanged",
        currentLineNumber: index + 1,
        snapshotLineNumber: index + 1,
        text,
      })),
      additions: 0,
      deletions: 0,
      charDelta: 0,
      hasChanges: false,
    };
  }

  let prefixCount = 0;
  while (
    prefixCount < aLines.length &&
    prefixCount < bLines.length &&
    aLines[prefixCount] === bLines[prefixCount]
  ) {
    prefixCount++;
  }
  let suffixCount = 0;
  while (
    suffixCount < aLines.length - prefixCount &&
    suffixCount < bLines.length - prefixCount &&
    aLines[aLines.length - 1 - suffixCount] === bLines[bLines.length - 1 - suffixCount]
  ) {
    suffixCount++;
  }

  const midA = aLines.slice(prefixCount, aLines.length - suffixCount);
  const midB = bLines.slice(prefixCount, bLines.length - suffixCount);
  const dp: number[][] = Array.from({ length: midA.length + 1 }, () =>
    Array.from({ length: midB.length + 1 }, () => 0),
  );
  for (let i = 1; i <= midA.length; i++) {
    for (let j = 1; j <= midB.length; j++) {
      dp[i][j] =
        midA[i - 1] === midB[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const middle: DiffLine[] = [];
  let i = midA.length;
  let j = midB.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midA[i - 1] === midB[j - 1]) {
      middle.push({ type: "unchanged", text: midA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      middle.push({ type: "added", text: midB[j - 1] });
      j--;
    } else {
      middle.push({ type: "removed", text: midA[i - 1] });
      i--;
    }
  }
  middle.reverse();

  const lines: DiffLine[] = [];
  let currentLine = 1;
  let snapshotLine = 1;
  let additions = 0;
  let deletions = 0;
  for (let index = 0; index < prefixCount; index++) {
    lines.push({
      type: "unchanged",
      currentLineNumber: currentLine++,
      snapshotLineNumber: snapshotLine++,
      text: aLines[index],
    });
  }
  for (const line of middle) {
    if (line.type === "unchanged") {
      lines.push({
        type: line.type,
        currentLineNumber: currentLine++,
        snapshotLineNumber: snapshotLine++,
        text: line.text,
      });
    } else if (line.type === "added") {
      lines.push({ type: line.type, snapshotLineNumber: snapshotLine++, text: line.text });
      additions++;
    } else {
      lines.push({ type: line.type, currentLineNumber: currentLine++, text: line.text });
      deletions++;
    }
  }
  for (let index = aLines.length - suffixCount; index < aLines.length; index++) {
    lines.push({
      type: "unchanged",
      currentLineNumber: currentLine++,
      snapshotLineNumber: snapshotLine++,
      text: aLines[index],
    });
  }

  return {
    lines,
    additions,
    deletions,
    charDelta,
    hasChanges: additions > 0 || deletions > 0,
  };
}
