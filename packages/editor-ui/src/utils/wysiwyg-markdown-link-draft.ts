interface WysiwygMarkdownLinkDraftMatch {
  readonly source: string;
  readonly startOffset: number;
}

export function findWysiwygMarkdownLinkDraft(
  textBefore: string,
  insertedText: string,
): WysiwygMarkdownLinkDraftMatch | null {
  const combined = textBefore + insertedText;
  for (let startOffset = combined.lastIndexOf("["); startOffset >= 0;) {
    if (!isEscapedCharacter(combined, startOffset)) {
      const source = readBalancedLinkDraft(combined, startOffset);
      if (source) {
        return { source, startOffset };
      }
    }

    // String#lastIndexOf clamps a negative fromIndex to zero. Searching again
    // from an unmatched bracket at index zero would otherwise never advance.
    if (startOffset === 0) {
      break;
    }
    startOffset = combined.lastIndexOf("[", startOffset - 1);
  }
  return null;
}

export function isEscapedCharacter(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function readBalancedLinkDraft(source: string, startOffset: number): string | null {
  let labelEnd = -1;
  for (let index = startOffset + 1; index < source.length; index += 1) {
    if (source[index] === "]" && !isEscapedCharacter(source, index)) {
      labelEnd = index;
      break;
    }
  }
  if (labelEnd === -1 || source[labelEnd + 1] !== "(") {
    return null;
  }

  let depth = 1;
  for (let index = labelEnd + 2; index < source.length; index += 1) {
    if (isEscapedCharacter(source, index)) {
      continue;
    }
    if (source[index] === "(") {
      depth += 1;
    } else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index === source.length - 1 ? source.slice(startOffset) : null;
      }
    }
  }
  return null;
}
