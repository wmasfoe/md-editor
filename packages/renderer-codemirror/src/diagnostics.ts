import { Facet, type EditorState, type Extension } from "@codemirror/state";

export type WysiwygWidgetKind = "task" | "image" | "thematic-break" | "default" | "frontmatter";

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
  readonly visibleMarkBuildCount: number;
  readonly parseCoverageRefreshCount: number;
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
];

function createWidgetCounts(): Record<WysiwygWidgetKind, MutableWidgetLifecycleCounts> {
  return {
    task: { create: 0, update: 0, destroy: 0 },
    image: { create: 0, update: 0, destroy: 0 },
    "thematic-break": { create: 0, update: 0, destroy: 0 },
    default: { create: 0, update: 0, destroy: 0 },
    frontmatter: { create: 0, update: 0, destroy: 0 },
  };
}

/** Internal mutable counter sink; callers can expose only immutable snapshots. */
export class WysiwygDiagnostics {
  #fullIndexBuildCount = 0;
  #dirtyBlockRebuildCount = 0;
  #mappedRangeCount = 0;
  #selectionDeltaUpdateCount = 0;
  #layoutDecorationReplaceCount = 0;
  #visibleMarkBuildCount = 0;
  #parseCoverageRefreshCount = 0;
  readonly #widgetLifecycleCounts = createWidgetCounts();
  readonly #safeFallbackDiagnosticCounts = new Map<string, number>();

  recordFullIndexBuild(): void {
    this.#fullIndexBuildCount += 1;
  }

  recordDirtyBlockRebuild(): void {
    this.#dirtyBlockRebuildCount += 1;
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

  recordVisibleMarkBuild(): void {
    this.#visibleMarkBuildCount += 1;
  }

  recordParseCoverageRefresh(): void {
    this.#parseCoverageRefreshCount += 1;
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
      visibleMarkBuildCount: this.#visibleMarkBuildCount,
      parseCoverageRefreshCount: this.#parseCoverageRefreshCount,
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
