import { redo, undo } from "@codemirror/commands";
import {
  EditorSelection,
  StateEffect,
  Transaction,
  type EditorState,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
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
