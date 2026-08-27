import { redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Markdown } from "@md-editor/shared";
import {
  createCodeMirrorRendererWithFactory,
  inspectRendererForTesting,
  type CodeMirrorRenderer,
  type CodeMirrorRendererOptions,
  type RendererTestingProbeInternal,
  type RendererViewAdapter,
  type RendererViewFactoryInput,
} from "./renderer.ts";
import {
  codeBlockLineNumberTheme,
  createCodeBlockLineNumberDecorations,
  type CodeBlockLogicalLine,
} from "./wysiwyg/code-block-line-numbers.ts";

const testScrollSnapshotEffect = StateEffect.define<null>();

class StateBackedViewAdapter implements RendererViewAdapter {
  #state: EditorState;
  #scrollTop = 0;
  #focused = false;
  #composing = false;
  #destroyed = false;
  readonly #onCompositionStart: () => void;
  readonly #onCompositionEnd: () => void;

  constructor(input: RendererViewFactoryInput) {
    this.#state = input.state;
    this.#onCompositionStart = input.onCompositionStart;
    this.#onCompositionEnd = input.onCompositionEnd;
  }

  get state(): EditorState {
    return this.#state;
  }

  get isComposing(): boolean {
    return this.#composing;
  }

  dispatch(spec: TransactionSpec): void {
    this.dispatchTransaction(this.#state.update(spec));
  }

  dispatchTransaction(transaction: Transaction): void {
    if (this.#destroyed) {
      throw new Error("The state-backed view is destroyed.");
    }
    if (transaction.startState !== this.#state) {
      throw new Error("Transaction does not start from the current test state.");
    }
    this.#state = transaction.state;
    const update = {
      state: this.#state,
      transactions: [transaction],
      docChanged: transaction.docChanged,
      selectionSet: transaction.selection !== undefined,
    } as unknown as ViewUpdate;
    for (const listener of this.#state.facet(EditorView.updateListener)) {
      listener(update);
    }
  }

  setState(state: EditorState): void {
    this.#state = state;
  }

  scrollSnapshot(): StateEffect<unknown> {
    return testScrollSnapshotEffect.of(null);
  }

  getScrollTop(): number {
    return this.#scrollTop;
  }

  setScrollTop(value: number): void {
    this.#scrollTop = value;
  }

  hasFocus(): boolean {
    return this.#focused;
  }

  focus(): void {
    this.#focused = true;
  }

  requestMeasure(afterMeasure?: () => void): void {
    // State-only tests assert the renderer request count, not browser layout behavior.
    afterMeasure?.();
  }

  destroy(): void {
    if (this.#destroyed) {
      throw new Error("The state-backed view was destroyed twice.");
    }
    this.#destroyed = true;
    this.#focused = false;
  }

  replaceAsUser(markdown: Markdown): void {
    this.dispatch({
      changes: { from: 0, to: this.#state.doc.length, insert: markdown },
      userEvent: "input.type",
    });
  }

  setSelection(anchor: number, head = anchor): void {
    this.dispatch({
      selection: EditorSelection.single(anchor, head),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  setSelections(ranges: readonly { readonly anchor: number; readonly head: number }[]): void {
    this.dispatch({
      selection: EditorSelection.create(
        ranges.map((range) => EditorSelection.range(range.anchor, range.head)),
      ),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  run(command: StateCommand): boolean {
    return command({
      state: this.#state,
      dispatch: (transaction) => this.dispatchTransaction(transaction),
    });
  }

  startComposition(): void {
    this.#composing = true;
    this.#onCompositionStart();
  }

  endComposition(): void {
    this.#composing = false;
    this.#onCompositionEnd();
  }
}

export interface RendererTestHarness {
  readonly renderer: CodeMirrorRenderer;
  probe(): RendererTestingProbeInternal;
  replaceAsUser(markdown: Markdown): void;
  setSelection(anchor: number, head?: number): void;
  setSelections(ranges: readonly { readonly anchor: number; readonly head: number }[]): void;
  setScrollTop(value: number): void;
  focus(): void;
  requestMeasure(): void;
  undo(): boolean;
  redo(): boolean;
  startComposition(): void;
  endComposition(): void;
}

export type RendererTestHarnessOptions = Omit<CodeMirrorRendererOptions, "parent"> & {
  readonly parent?: HTMLElement;
};

export function createRendererTestHarness(
  options: RendererTestHarnessOptions,
): RendererTestHarness {
  let view: StateBackedViewAdapter | null = null;
  const renderer = createCodeMirrorRendererWithFactory(
    { ...options, parent: options.parent ?? ({} as HTMLElement) },
    (input) => {
      view = new StateBackedViewAdapter(input);
      return view;
    },
  );

  function requireView(): StateBackedViewAdapter {
    if (view === null) {
      throw new Error("The renderer test view was not constructed.");
    }
    return view;
  }

  return Object.freeze({
    renderer,
    probe: () => inspectRendererForTesting(renderer),
    replaceAsUser: (markdown: Markdown) => requireView().replaceAsUser(markdown),
    setSelection: (anchor: number, head?: number) => requireView().setSelection(anchor, head),
    setSelections: (ranges: readonly { readonly anchor: number; readonly head: number }[]) =>
      requireView().setSelections(ranges),
    setScrollTop: (value: number) => requireView().setScrollTop(value),
    focus: () => renderer.focus(),
    requestMeasure: () => renderer.requestMeasure(),
    undo: () => requireView().run(undo),
    redo: () => requireView().run(redo),
    startComposition: () => requireView().startComposition(),
    endComposition: () => requireView().endComposition(),
  });
}

export { inspectRendererForTesting };
export type { RendererTestingProbeInternal as RendererTestingProbe };
export { getM2CodeBlockPerformanceFixture } from "./markdown/fixtures.ts";

export function installCodeBlockLineNumberGeometryFixture(parent: HTMLElement): EditorView {
  const document = [
    "ordinary prelude",
    "const first = 1;",
    `const wrapped = "${"wrapped-source ".repeat(18)}";`,
    "return first;",
    "ordinary separator",
    "plain one",
    `plain wrapped ${"content ".repeat(24)}`,
    "ordinary tail",
  ].join("\n");

  const lineNumbers = StateField.define<DecorationSet>({
    create(state) {
      const lines: readonly CodeBlockLogicalLine[] = [
        { from: state.doc.line(2).from, blockId: "typescript", lineNumber: 1, gutterDigits: 1 },
        { from: state.doc.line(3).from, blockId: "typescript", lineNumber: 2, gutterDigits: 1 },
        { from: state.doc.line(4).from, blockId: "typescript", lineNumber: 3, gutterDigits: 1 },
        { from: state.doc.line(6).from, blockId: "plain", lineNumber: 1, gutterDigits: 1 },
        { from: state.doc.line(7).from, blockId: "plain", lineNumber: 2, gutterDigits: 1 },
      ];
      return createCodeBlockLineNumberDecorations(lines);
    },
    update(decorations) {
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return new EditorView({
    parent,
    state: EditorState.create({
      doc: document,
      extensions: [EditorView.lineWrapping, lineNumbers, codeBlockLineNumberTheme],
    }),
  });
}
