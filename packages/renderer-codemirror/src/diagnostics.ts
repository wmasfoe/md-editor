import { Facet, type EditorState, type Extension } from "@codemirror/state";

export type WysiwygWidgetKind =
  "task" | "image" | "thematic-break" | "default" | "frontmatter" | "code-block" | "table" | "html";

export interface WidgetLifecycleCounts {
  readonly create: number;
  readonly update: number;
  readonly destroy: number;
}

export interface WysiwygDiagnosticsSnapshot {
  readonly fullIndexBuildCount: number;
  readonly dirtyBlockRebuildCount: number;
  readonly mappedRangeCount: number;
  readonly selectionDeltaUpdateCount: number;
  readonly layoutDecorationReplaceCount: number;
  readonly fullProjectionBuildCount: number;
  readonly dirtyCodeBlockRebuildCount: number;
  readonly lastDirtyBlockRanges: readonly { readonly from: number; readonly to: number }[];
  readonly languageLoadAttemptCount: number;
  readonly languageLoadSuccessCount: number;
  readonly languageLoadFailureCount: number;
  readonly visibleMarkBuildCount: number;
  readonly parseCoverageRefreshCount: number;
  readonly codeBlockLineNumbersToggleCount: number;
  readonly codeBlockCopyInvocationCount: number;
  readonly codeBlockCopySuccessCount: number;
  readonly codeBlockCopyFailureCount: number;
  readonly protectedChangeRejectionCount: number;
  readonly widgetLifecycleCounts: Readonly<Record<WysiwygWidgetKind, WidgetLifecycleCounts>>;
  readonly safeFallbackDiagnosticCounts: Readonly<Record<string, number>>;
  readonly safeFallbackDiagnosticCodes: readonly string[];
}

type MutableWidgetLifecycleCounts = {
  create: number;
  update: number;
  destroy: number;
};

const WIDGET_KINDS: readonly WysiwygWidgetKind[] = [
  "task",
  "image",
  "thematic-break",
  "default",
  "frontmatter",
  "code-block",
  "table",
  "html",
];

function createWidgetCounts(): Record<WysiwygWidgetKind, MutableWidgetLifecycleCounts> {
  return {
    task: { create: 0, update: 0, destroy: 0 },
    image: { create: 0, update: 0, destroy: 0 },
    "thematic-break": { create: 0, update: 0, destroy: 0 },
    default: { create: 0, update: 0, destroy: 0 },
    frontmatter: { create: 0, update: 0, destroy: 0 },
    "code-block": { create: 0, update: 0, destroy: 0 },
    table: { create: 0, update: 0, destroy: 0 },
    html: { create: 0, update: 0, destroy: 0 },
  };
}

/** Internal mutable counter sink; callers can expose only immutable snapshots. */
export class WysiwygDiagnostics {
  #fullIndexBuildCount = 0;
  #dirtyBlockRebuildCount = 0;
  #mappedRangeCount = 0;
  #selectionDeltaUpdateCount = 0;
  #layoutDecorationReplaceCount = 0;
  #fullProjectionBuildCount = 0;
  #dirtyCodeBlockRebuildCount = 0;
  #lastDirtyBlockRanges: readonly { readonly from: number; readonly to: number }[] = [];
  #languageLoadAttemptCount = 0;
  #languageLoadSuccessCount = 0;
  #languageLoadFailureCount = 0;
  #visibleMarkBuildCount = 0;
  #parseCoverageRefreshCount = 0;
  #codeBlockLineNumbersToggleCount = 0;
  #codeBlockCopyInvocationCount = 0;
  #codeBlockCopySuccessCount = 0;
  #codeBlockCopyFailureCount = 0;
  #protectedChangeRejectionCount = 0;
  readonly #widgetLifecycleCounts = createWidgetCounts();
  readonly #safeFallbackDiagnosticCounts = new Map<string, number>();

  recordFullIndexBuild(): void {
    this.#fullIndexBuildCount += 1;
  }

  recordDirtyBlockRebuild(
    ranges: readonly { readonly from: number; readonly to: number }[] = [],
  ): void {
    this.#dirtyBlockRebuildCount += 1;
    this.#lastDirtyBlockRanges = Object.freeze(
      ranges.map((range) => Object.freeze({ from: range.from, to: range.to })),
    );
  }

  recordMappedRanges(count: number): void {
    this.#mappedRangeCount += count;
  }

  recordSelectionDeltaUpdate(): void {
    this.#selectionDeltaUpdateCount += 1;
  }

  recordLayoutDecorationReplace(count = 1): void {
    this.#layoutDecorationReplaceCount += count;
  }

  recordFullProjectionBuild(): void {
    this.#fullProjectionBuildCount += 1;
  }

  recordDirtyCodeBlockRebuild(count = 1): void {
    this.#dirtyCodeBlockRebuildCount += count;
  }

  recordLanguageLoadAttempt(): void {
    this.#languageLoadAttemptCount += 1;
  }

  recordLanguageLoadSuccess(): void {
    this.#languageLoadSuccessCount += 1;
  }

  recordLanguageLoadFailure(): void {
    this.#languageLoadFailureCount += 1;
  }

  recordVisibleMarkBuild(): void {
    this.#visibleMarkBuildCount += 1;
  }

  recordParseCoverageRefresh(): void {
    this.#parseCoverageRefreshCount += 1;
  }

  recordCodeBlockLineNumbersToggle(): void {
    this.#codeBlockLineNumbersToggleCount += 1;
  }

  recordCodeBlockCopyInvocation(): void {
    this.#codeBlockCopyInvocationCount += 1;
  }

  recordCodeBlockCopySuccess(): void {
    this.#codeBlockCopySuccessCount += 1;
  }

  recordCodeBlockCopyFailure(): void {
    this.#codeBlockCopyFailureCount += 1;
  }

  recordProtectedChangeRejection(): void {
    this.#protectedChangeRejectionCount += 1;
  }

  recordWidgetLifecycle(kind: WysiwygWidgetKind, event: keyof MutableWidgetLifecycleCounts): void {
    this.#widgetLifecycleCounts[kind][event] += 1;
  }

  recordSafeFallback(code: string): void {
    this.#safeFallbackDiagnosticCounts.set(
      code,
      (this.#safeFallbackDiagnosticCounts.get(code) ?? 0) + 1,
    );
  }

  snapshot(): WysiwygDiagnosticsSnapshot {
    const widgetLifecycleCounts = Object.fromEntries(
      WIDGET_KINDS.map((kind) => [kind, Object.freeze({ ...this.#widgetLifecycleCounts[kind] })]),
    ) as Record<WysiwygWidgetKind, WidgetLifecycleCounts>;
    const safeFallbackDiagnosticCounts = Object.freeze(
      Object.fromEntries(this.#safeFallbackDiagnosticCounts),
    );

    return Object.freeze({
      fullIndexBuildCount: this.#fullIndexBuildCount,
      dirtyBlockRebuildCount: this.#dirtyBlockRebuildCount,
      mappedRangeCount: this.#mappedRangeCount,
      selectionDeltaUpdateCount: this.#selectionDeltaUpdateCount,
      layoutDecorationReplaceCount: this.#layoutDecorationReplaceCount,
      fullProjectionBuildCount: this.#fullProjectionBuildCount,
      dirtyCodeBlockRebuildCount: this.#dirtyCodeBlockRebuildCount,
      lastDirtyBlockRanges: this.#lastDirtyBlockRanges,
      languageLoadAttemptCount: this.#languageLoadAttemptCount,
      languageLoadSuccessCount: this.#languageLoadSuccessCount,
      languageLoadFailureCount: this.#languageLoadFailureCount,
      visibleMarkBuildCount: this.#visibleMarkBuildCount,
      parseCoverageRefreshCount: this.#parseCoverageRefreshCount,
      codeBlockLineNumbersToggleCount: this.#codeBlockLineNumbersToggleCount,
      codeBlockCopyInvocationCount: this.#codeBlockCopyInvocationCount,
      codeBlockCopySuccessCount: this.#codeBlockCopySuccessCount,
      codeBlockCopyFailureCount: this.#codeBlockCopyFailureCount,
      protectedChangeRejectionCount: this.#protectedChangeRejectionCount,
      widgetLifecycleCounts: Object.freeze(widgetLifecycleCounts),
      safeFallbackDiagnosticCounts,
      safeFallbackDiagnosticCodes: Object.freeze(Object.keys(safeFallbackDiagnosticCounts)),
    });
  }
}

const wysiwygDiagnosticsFacet = Facet.define<WysiwygDiagnostics, WysiwygDiagnostics | null>({
  combine(values) {
    return values.at(-1) ?? null;
  },
});

export function provideWysiwygDiagnostics(diagnostics: WysiwygDiagnostics): Extension {
  return wysiwygDiagnosticsFacet.of(diagnostics);
}

export function getWysiwygDiagnostics(state: EditorState): WysiwygDiagnostics | null {
  return state.facet(wysiwygDiagnosticsFacet);
}
