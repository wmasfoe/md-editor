/**
 * @file line-diff.ts
 * @description
 * 极简、高保真行级差分比较引擎（基于 LCS 算法 + 前后缀修剪优化），
 * 用于在文档历史版本抽屉中直观对比当前编辑器内容与历史快照之间的差异。
 */

export interface DiffLine {
  readonly type: "added" | "removed" | "unchanged";
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

/**
 * 比较当前工作区文本与历史快照文本，生成结构化行级差异结果。
 * 基准：当前工作区 (currentText) -> 历史快照 (snapshotText)。
 * - added (+): 快照中存在但当前工作区已删除的内容（恢复时将找回）
 * - removed (-): 当前工作区新增但快照中不存在的内容（恢复时将被替换）
 * - unchanged: 两者一致的内容
 */
export function computeLineDiff(currentText: string, snapshotText: string): DiffResult {
  const charDelta = snapshotText.length - currentText.length;

  if (currentText === snapshotText) {
    const rawLines = currentText ? currentText.split(/\r?\n/) : [];
    const lines: DiffLine[] = rawLines.map((text, idx) => ({
      type: "unchanged",
      currentLineNumber: idx + 1,
      snapshotLineNumber: idx + 1,
      text,
    }));
    return {
      lines,
      additions: 0,
      deletions: 0,
      charDelta: 0,
      hasChanges: false,
    };
  }

  const aLines = currentText ? currentText.split(/\r?\n/) : [];
  const bLines = snapshotText ? snapshotText.split(/\r?\n/) : [];

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

  // LCS 矩阵求解中间差异部分
  const dp: number[][] = Array.from({ length: midA.length + 1 }, () =>
    Array.from({ length: midB.length + 1 }, () => 0),
  );

  for (let i = 1; i <= midA.length; i++) {
    for (let j = 1; j <= midB.length; j++) {
      if (midA[i - 1] === midB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯构建中间 diff 序列
  const midDiff: { type: "added" | "removed" | "unchanged"; text: string }[] = [];
  let i = midA.length;
  let j = midB.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midA[i - 1] === midB[j - 1]) {
      midDiff.push({ type: "unchanged", text: midA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      midDiff.push({ type: "added", text: midB[j - 1] });
      j--;
    } else if (i > 0) {
      midDiff.push({ type: "removed", text: midA[i - 1] });
      i--;
    }
  }
  midDiff.reverse();

  // 组装完整行号序列
  const resultLines: DiffLine[] = [];
  let currLine = 1;
  let snapLine = 1;
  let additions = 0;
  let deletions = 0;

  // 1. 公共前缀
  for (let k = 0; k < prefixCount; k++) {
    resultLines.push({
      type: "unchanged",
      currentLineNumber: currLine++,
      snapshotLineNumber: snapLine++,
      text: aLines[k],
    });
  }

  // 2. 中间差异
  for (const item of midDiff) {
    if (item.type === "unchanged") {
      resultLines.push({
        type: "unchanged",
        currentLineNumber: currLine++,
        snapshotLineNumber: snapLine++,
        text: item.text,
      });
    } else if (item.type === "added") {
      additions++;
      resultLines.push({
        type: "added",
        snapshotLineNumber: snapLine++,
        text: item.text,
      });
    } else {
      deletions++;
      resultLines.push({
        type: "removed",
        currentLineNumber: currLine++,
        text: item.text,
      });
    }
  }

  // 3. 公共后缀
  for (let k = aLines.length - suffixCount; k < aLines.length; k++) {
    resultLines.push({
      type: "unchanged",
      currentLineNumber: currLine++,
      snapshotLineNumber: snapLine++,
      text: aLines[k],
    });
  }

  return {
    lines: resultLines,
    additions,
    deletions,
    charDelta,
    hasChanges: additions > 0 || deletions > 0,
  };
}
