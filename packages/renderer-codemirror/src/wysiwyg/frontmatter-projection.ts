import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { FrontmatterSourceRange } from "@md-editor/markdown-fidelity";
import { getWysiwygDiagnostics } from "../diagnostics.ts";
import {
  analyzeFrontmatterYaml,
  type FrontmatterYamlAnalysis,
} from "../markdown/frontmatter-yaml.ts";
import {
  fingerprintSource,
  type MarkdownRangeRecord,
  type SourceRange,
} from "../markdown/range-types.ts";
import { FrontmatterHeaderWidget } from "./widgets/frontmatter-header-widget.ts";

export function buildFrontmatterLayoutDecorations(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  const frontmatter = resolveFrontmatter(record, state);
  if (!frontmatter) {
    return [];
  }
  const analysis = analyzeFrontmatterYaml(frontmatter);
  const hasError = analysis.diagnostics.length > 0;
  const ranges: Range<Decoration>[] = [
    Decoration.replace({
      widget: new FrontmatterHeaderWidget({
        recordId: record.id,
        status: frontmatter.status,
        errorCount: analysis.diagnostics.length,
        diagnostics: getWysiwygDiagnostics(state),
      }),
      inclusive: false,
      wysiwygRecordId: record.id,
      wysiwygRole: "frontmatter-header",
    }).range(frontmatter.openingFenceRange.from, frontmatter.openingFenceRange.to),
    frontmatterLineDecoration(record.id, "header", hasError).range(
      state.doc.lineAt(frontmatter.openingFenceRange.from).from,
    ),
  ];

  for (const lineFrom of frontmatterBodyLineStarts(frontmatter.contentRange, state)) {
    ranges.push(frontmatterLineDecoration(record.id, "body", hasError).range(lineFrom));
  }
  if (frontmatter.closingFenceRange) {
    ranges.push(
      Decoration.replace({
        inclusive: false,
        wysiwygRecordId: record.id,
        wysiwygRole: "frontmatter-closing-fence",
      }).range(frontmatter.closingFenceRange.from, frontmatter.closingFenceRange.to),
      frontmatterLineDecoration(record.id, "footer", hasError).range(
        state.doc.lineAt(frontmatter.closingFenceRange.from).from,
      ),
    );
  }
  ranges.push(...yamlTokenDecorations(record.id, analysis));
  ranges.push(...yamlErrorDecorations(record.id, analysis));
  return ranges;
}

export function buildFrontmatterAtomicRanges(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly Range<Decoration>[] {
  const frontmatter = resolveFrontmatter(record, state);
  if (!frontmatter) {
    return [];
  }
  return [frontmatter.openingFenceRange, frontmatter.closingFenceRange]
    .filter((range): range is SourceRange => range !== null)
    .map((range) =>
      Decoration.mark({
        wysiwygRecordId: record.id,
        wysiwygRole: "frontmatter-fence-atomic",
      }).range(range.from, range.to),
    );
}

export function getFrontmatterProtectedRanges(
  record: MarkdownRangeRecord,
  state: EditorState,
): readonly SourceRange[] {
  const frontmatter = resolveFrontmatter(record, state);
  return frontmatter
    ? Object.freeze(
        [frontmatter.openingFenceRange, frontmatter.closingFenceRange].filter(
          (range): range is SourceRange => range !== null,
        ),
      )
    : Object.freeze([]);
}

function resolveFrontmatter(
  record: MarkdownRangeRecord,
  state: EditorState,
): FrontmatterSourceRange | null {
  if (record.kind !== "frontmatter" || !record.contentRange || record.markerRanges.length === 0) {
    return null;
  }
  const raw = state.sliceDoc(record.fullRange.from, record.fullRange.to);
  if (record.parserCoverage !== "complete" || fingerprintSource(raw) !== record.sourceFingerprint) {
    getWysiwygDiagnostics(state)?.recordSafeFallback("FRONTMATTER_SOURCE_MISMATCH");
    return null;
  }
  const status = record.nodeName === "Frontmatter" ? "closed" : "unterminated";
  const openingFenceRange = record.markerRanges[0];
  const closingFenceRange = status === "closed" ? (record.markerRanges[1] ?? null) : null;
  return Object.freeze({
    status,
    precedence: "frontmatter",
    fullRange: record.fullRange,
    openingFenceRange,
    contentRange: record.contentRange,
    closingFenceRange,
    raw,
    content: state.sliceDoc(record.contentRange.from, record.contentRange.to),
  });
}

function frontmatterLineDecoration(
  recordId: string,
  role: "header" | "body" | "footer",
  hasError: boolean,
): Decoration {
  return Decoration.line({
    class: [
      "cm-md-frontmatter-line",
      `cm-md-frontmatter-line--${role}`,
      ...(hasError ? ["cm-md-frontmatter-line--error"] : []),
    ].join(" "),
    wysiwygRecordId: recordId,
    wysiwygRole: `frontmatter-${role}-line`,
  });
}

function frontmatterBodyLineStarts(range: SourceRange, state: EditorState): readonly number[] {
  const starts: number[] = [];
  let position = range.from;
  while (position < range.to) {
    const line = state.doc.lineAt(position);
    starts.push(line.from);
    if (line.to >= range.to) {
      break;
    }
    position = line.to + 1;
  }
  return Object.freeze(starts);
}

function yamlTokenDecorations(
  recordId: string,
  analysis: FrontmatterYamlAnalysis,
): readonly Range<Decoration>[] {
  return analysis.tokens.map((token) =>
    Decoration.mark({
      class: `cm-md-yaml-${token.kind}`,
      wysiwygRecordId: recordId,
      wysiwygRole: `frontmatter-yaml-${token.kind}`,
    }).range(token.from, token.to),
  );
}

function yamlErrorDecorations(
  recordId: string,
  analysis: FrontmatterYamlAnalysis,
): readonly Range<Decoration>[] {
  return analysis.diagnostics
    .filter((diagnostic) => diagnostic.from < diagnostic.to)
    .map((diagnostic) =>
      Decoration.mark({
        class: "cm-md-yaml-error",
        attributes: { "aria-invalid": "true" },
        wysiwygRecordId: recordId,
        wysiwygRole: "frontmatter-yaml-error",
      }).range(diagnostic.from, diagnostic.to),
    );
}
