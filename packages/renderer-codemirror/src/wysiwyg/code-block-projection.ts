import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import type {
  MarkdownCodeBlockMetadata,
  MarkdownRangeRecord,
  SourceRange,
} from "../markdown/range-types.ts";
import { type CodeBlockLogicalLine } from "./code-block-line-numbers.ts";
import {
  type CodeBlockIndentPlan,
  resolveCodeBlockIndentPlan,
  resolveHiddenIndentRange,
} from "./code-block-indent.ts";
import { CodeBlockToolbarWidget } from "./widgets/code-block-toolbar-widget.ts";

export const setCodeBlockLineNumbersEffect = StateEffect.define<boolean>();

export const initialCodeBlockLineNumbersFacet = Facet.define<boolean, boolean>({
  combine(values) {
    return values.at(-1) ?? false;
  },
});

export const codeBlockLineNumbersField = StateField.define<boolean>({
  create(state) {
    return state.facet(initialCodeBlockLineNumbersFacet);
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCodeBlockLineNumbersEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

export function isProjectableCodeBlock(record: MarkdownRangeRecord): boolean {
  return (
    record.kind === "deferred-code" &&
    record.parserCoverage === "complete" &&
    record.codeBlock?.blockStatus === "closed"
  );
}

export function getFencedCodeBlockBodyRange(
  state: EditorState,
  record: MarkdownRangeRecord,
): SourceRange | null {
  const metadata = record.codeBlock;
  if (
    metadata?.blockKind !== "fenced" ||
    !metadata.openingFenceRange ||
    !metadata.closingFenceRange
  ) {
    return null;
  }
  const openingLine = state.doc.lineAt(metadata.openingFenceRange.to);
  const closingLine = state.doc.lineAt(metadata.closingFenceRange.from);
  return {
    from: Math.min(openingLine.to + 1, state.doc.length),
    to: closingLine.from,
  };
}

export function getEmptyFencedCodeBlockBodyAnchor(
  state: EditorState,
  record: MarkdownRangeRecord,
): number | null {
  const bodyRange = getFencedCodeBlockBodyRange(state, record);
  return bodyRange && bodyRange.from === bodyRange.to ? bodyRange.from : null;
}

export function buildCodeBlockLayoutDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  lineNumbers: boolean,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!isProjectableCodeBlock(record) || !record.codeBlock) {
    return [];
  }

  // 结构性缩进（围栏自身缩进 + 容器缩进）从正文文本里剥离，卡片是否整体右移由容器决定。
  const indentPlan = resolveCodeBlockIndentPlan(record, state);

  return [
    ...buildHiddenSyntaxDecorations(record),
    ...buildStructuralLineDecorations(record, state),
    ...buildHiddenIndentDecorations(record, indentPlan, state),
    ...buildBodyLineDecorations(record, active, lineNumbers, indentPlan, state),
    Decoration.widget({
      widget: new CodeBlockToolbarWidget({
        recordId: record.id,
        blockKind: record.codeBlock.blockKind,
        languageLabel:
          record.codeBlock.languageInfo.resolvedName ??
          (record.codeBlock.languageInfo.token || "Plain"),
        active,
        diagnostics: getWysiwygDiagnostics(state),
        insetColumns: indentPlan.cardInsetColumns,
      }),
      block: true,
      side: -1,
      wysiwygRecordId: record.id,
    }).range(record.codeBlock.sourceBlockRange.from),
    ...(record.codeBlock.blockKind === "fenced"
      ? [
          Decoration.widget({
            widget: new CodeBlockSpacerWidget(),
            block: true,
            side: 1,
            wysiwygRecordId: record.id,
          }).range(record.codeBlock.sourceBlockRange.to),
        ]
      : []),
  ];
}

export class CodeBlockSpacerWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const spacer = view.dom.ownerDocument.createElement("div");
    spacer.className = "cm-md-code-block-spacer";
    spacer.setAttribute("aria-hidden", "true");
    return spacer;
  }

  override get estimatedHeight(): number {
    return 10;
  }
}

export function buildCodeBlockAtomicRanges(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  // 隐藏的结构性缩进前缀也纳入原子范围：光标不会停在隐藏缩进内部，
  // Home/方向键直接落到代码起点，避免"在不可见位置输入"的错觉。
  // 注意：它不进入 protectedRanges——否则在代码起点输入会被判为触碰禁用区而静默拒绝。
  const indentPlan = resolveCodeBlockIndentPlan(record, state);
  const indentRanges =
    indentPlan.stripColumns > 0
      ? collectCodeBlockLogicalLines(record, state)
          .map((line) => resolveHiddenIndentRange(state, line.from, indentPlan.stripColumns))
          .filter((range): range is SourceRange => range !== null)
      : [];
  return [...getCodeBlockProtectedRanges(record), ...indentRanges].map((range) =>
    Decoration.replace({
      inclusive: true,
      wysiwygRecordId: record.id,
      atomic: true,
    }).range(range.from, range.to),
  );
}

export function getCodeBlockProtectedRanges(record: MarkdownRangeRecord): readonly SourceRange[] {
  if (!isProjectableCodeBlock(record) || !record.codeBlock) {
    return [];
  }
  return freezeRanges(
    [
      record.codeBlock.openingFenceRange,
      record.codeBlock.rawInfoRange,
      record.codeBlock.closingFenceRange,
      ...record.codeBlock.syntaxIndentRanges,
    ].filter((range): range is SourceRange => range !== null && range.from < range.to),
  );
}

export const codeBlockProjectionTheme: Extension = EditorView.baseTheme({
  ".cm-md-code-toolbar-row": {
    // 承载结构性缩进：字体与代码行保持一致（等宽 + 同字号），使 1ch 精确等于一个空格的宽度。
    // 该容器只包含块级工具栏，不产生行框，因此字号/行高不参与布局测量。
    fontFamily:
      "var(--theme-mono-font, var(--md-editor-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace))",
    fontSize: "0.88em",
    marginInlineStart: "calc(var(--md-code-inset, 0) * 1ch)",
  },
  ".cm-md-code-toolbar": {
    display: "flex",
    gap: "0.375rem",
    alignItems: "center",
    paddingBlock: "0.125rem",
    color: "var(--theme-muted, currentColor)",
    fontSize: "0.75rem",
  },
  ".cm-md-code-toolbar--active": {
    color: "var(--theme-text, currentColor)",
  },
  ".cm-md-code-toolbar button, .cm-md-code-toolbar select": {
    font: "inherit",
  },
  ".cm-md-code-toolbar__status": {
    display: "inline-block",
    minWidth: "5.5rem",
  },
  ".cm-md-code-line": {
    fontFamily:
      "var(--theme-mono-font, var(--md-editor-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace))",
    backgroundColor: "var(--theme-code-bg, var(--theme-bg-muted, transparent))",
    // 列表/任务子项的层级由卡片整体右移表达；该元素字体为等宽，1ch 即一个空格宽度。
    marginInlineStart: "calc(var(--md-code-inset, 0) * 1ch)",
    outline: "none",
  },
  ".cm-md-code-line--active": {
    backgroundColor: "var(--theme-code-bg, var(--theme-bg-muted, transparent))",
    outline: "none",
  },
  ".cm-md-code-structural-line-hidden": {
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
    paddingBlock: "0",
  },
  ".cm-md-code-block-spacer": {
    height: "0.65rem",
    pointerEvents: "none",
  },
});

function buildHiddenSyntaxDecorations(record: MarkdownRangeRecord): readonly Range<Decoration>[] {
  const ranges = getCodeBlockProtectedRanges(record);
  return ranges.map((range) =>
    Decoration.replace({
      inclusive: true,
      wysiwygRecordId: record.id,
      hiddenCodeBlockSyntax: true,
    }).range(range.from, range.to),
  );
}

function buildStructuralLineDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!record.codeBlock || record.codeBlock.blockKind !== "fenced") {
    return [];
  }
  const emptyBodyAnchor = getEmptyFencedCodeBlockBodyAnchor(state, record);
  return (
    [record.codeBlock.openingFenceRange, record.codeBlock.closingFenceRange]
      .filter((range): range is SourceRange => range !== null)
      // 行装饰必须挂在行首：围栏字符可能不在行首（前置缩进、容器去缩进），
      // 晚于行首的 LineDecoration 会被 CM6 静默丢弃，导致该行按全高渲染。
      .map((range) => state.doc.lineAt(range.from).from)
      // 空体围栏代码块的闭合围栏行同时是可见代码行，按行首粒度排除折叠。
      .filter((from) => from !== emptyBodyAnchor)
      .map((from) =>
        Decoration.line({
          attributes: {
            class: "cm-md-code-structural-line-hidden",
            "aria-hidden": "true",
            "data-md-code-block-id": record.id,
            "data-md-code-structural-line": "fence",
          },
          wysiwygRecordId: record.id,
        }).range(from),
      )
  );
}

/**
 * 隐藏正文行的结构性缩进前缀（围栏自身缩进 + 容器缩进）。
 *
 * 隐藏后代码在卡片内左对齐；列表/任务子项的缩进改由卡片整体右移（`--md-code-inset`）表达，
 * 因此不会丢失层级信息。代码内容自身的缩进（超出 `stripColumns` 的部分）不受影响。
 */
function buildHiddenIndentDecorations(
  record: MarkdownRangeRecord,
  indentPlan: CodeBlockIndentPlan,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (indentPlan.stripColumns <= 0) {
    return [];
  }
  const ranges: Range<Decoration>[] = [];
  for (const line of collectCodeBlockLogicalLines(record, state)) {
    const hidden = resolveHiddenIndentRange(state, line.from, indentPlan.stripColumns);
    if (!hidden) {
      continue;
    }
    ranges.push(
      Decoration.replace({
        inclusive: true,
        wysiwygRecordId: record.id,
        hiddenCodeBlockIndent: true,
      }).range(hidden.from, hidden.to),
    );
  }
  return ranges;
}

function buildBodyLineDecorations(
  record: MarkdownRangeRecord,
  active: boolean,
  lineNumbers: boolean,
  indentPlan: CodeBlockIndentPlan,
  state: EditorState,
): readonly Range<Decoration>[] {
  if (!record.codeBlock) {
    return [];
  }
  const logicalLines = collectCodeBlockLogicalLines(record, state);
  return logicalLines.map((line, index) => {
    const classes = ["cm-md-code-line"];
    if (index === 0) {
      classes.push("cm-md-code-line--first");
    }
    if (index === logicalLines.length - 1) {
      classes.push("cm-md-code-line--last");
    }
    if (active) {
      classes.push("cm-md-code-line--active");
    }
    const numbered = lineNumbers ? line : null;
    if (numbered) {
      classes.push("cm-md-code-line-numbered");
    }
    const inlineStyle = [
      numbered ? `--md-code-line-number-width: ${String(numbered.gutterDigits)}ch` : null,
      indentPlan.cardInsetColumns > 0
        ? `--md-code-inset: ${String(indentPlan.cardInsetColumns)}`
        : null,
    ].filter((value): value is string => value !== null);
    return Decoration.line({
      attributes: {
        class: classes.join(" "),
        "data-md-code-block-id": record.id,
        ...(numbered ? { "data-md-code-line-number": String(numbered.lineNumber) } : {}),
        ...(inlineStyle.length > 0 ? { style: inlineStyle.join("; ") } : {}),
      },
      wysiwygRecordId: record.id,
    }).range(line.from);
  });
}

function collectCodeBlockLogicalLines(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly CodeBlockLogicalLine[] {
  const metadata = record.codeBlock;
  if (!metadata) {
    return [];
  }
  const starts = collectSemanticLineStarts(metadata, state);
  const gutterDigits = Math.max(1, String(starts.length).length);
  return Object.freeze(
    starts.map((from, index) =>
      Object.freeze({
        from,
        blockId: record.id,
        lineNumber: index + 1,
        gutterDigits,
      }),
    ),
  );
}

function collectSemanticLineStarts(
  metadata: MarkdownCodeBlockMetadata,
  state: EditorState,
): readonly number[] {
  const starts = new Set<number>();
  if (
    metadata.blockKind === "fenced" &&
    metadata.bodySegments.length === 0 &&
    metadata.closingFenceRange
  ) {
    starts.add(state.doc.lineAt(metadata.closingFenceRange.from).from);
  }
  for (const segment of metadata.bodySegments) {
    if (segment.from > segment.to) {
      continue;
    }
    let position = segment.from;
    while (position <= segment.to && position <= state.doc.length) {
      const line = state.doc.lineAt(Math.min(position, state.doc.length));
      // 语义行起点恒为物理行首：bodySegments 的 from 会被容器（列表/引用）去缩进而落在行中。
      starts.add(line.from);
      if (line.to >= segment.to || line.to === state.doc.length) {
        break;
      }
      position = line.to + 1;
    }
  }
  const orderedStarts = [...starts];
  // oxlint-disable-next-line unicorn/no-array-sort -- The production TypeScript target is ES2022.
  orderedStarts.sort((left, right) => left - right);
  return Object.freeze(orderedStarts);
}

function freezeRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
  return Object.freeze(ranges.map((range) => Object.freeze({ ...range })));
}
