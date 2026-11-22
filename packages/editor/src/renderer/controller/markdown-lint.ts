/**
 * @file markdown-lint.ts
 * @description 编辑器侧的 lint 状态机：开关、引擎、重算。
 *
 * 引擎可以在**运行时late-arrive**（宿主把 markdownlint 改成动态 import 后，引擎会比视图晚到），
 * 因此引擎单独占一个 compartment：到达后只需 reconfigure 一次 facet，不必重建视图。
 */
import { Compartment } from "@codemirror/state";

import { markdownLintEngineFacet, type MarkdownLintEngine } from "../../lint/engine.ts";
import type { MarkdownLintPortResult, RendererViewAdapter } from "../types.ts";
import { configureViewMarkdownLint, recomputeViewMarkdownLint } from "./view-operations.ts";

export interface MarkdownLintControllerOptions {
  readonly enabled: boolean;
  readonly engine: MarkdownLintEngine | undefined;
  readonly getView: () => RendererViewAdapter;
  readonly isDestroyed: () => boolean;
}

export class MarkdownLintController {
  /** 实时 lint 扩展的开关位。 */
  readonly compartment = new Compartment();
  /** 引擎 facet 的开关位：late-arrive 时只 reconfigure 这里。 */
  readonly engineCompartment = new Compartment();

  #enabled: boolean;
  #engine: MarkdownLintEngine | undefined;
  readonly #getView: () => RendererViewAdapter;
  readonly #isDestroyed: () => boolean;

  constructor(options: MarkdownLintControllerOptions) {
    this.#enabled = options.enabled;
    this.#engine = options.engine;
    this.#getView = options.getView;
    this.#isDestroyed = options.isDestroyed;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get engine(): MarkdownLintEngine | undefined {
    return this.#engine;
  }

  setEnabled(enabled: boolean): MarkdownLintPortResult {
    if (this.#isDestroyed()) return { status: "destroyed" };
    if (enabled === this.#enabled) return { status: "noop" };
    this.#enabled = enabled;
    configureViewMarkdownLint(this.#getView(), this.compartment, enabled);
    return { status: "applied" };
  }

  /** 运行期注入/替换引擎（宿主动态 import 完成后调用）。 */
  setEngine(engine: MarkdownLintEngine | undefined): MarkdownLintPortResult {
    if (this.#isDestroyed()) return { status: "destroyed" };
    if (engine === this.#engine) return { status: "noop" };
    this.#engine = engine;
    const view = this.#getView();
    view.dispatch({
      effects: this.engineCompartment.reconfigure(markdownLintEngineFacet.of(engine)),
    });
    // 引擎到位时若开关已打开，立即补一次，避免"开关开着但没结果"的静默空窗。
    if (this.#enabled) configureViewMarkdownLint(view, this.compartment, true);
    return { status: "applied" };
  }

  recompute(): MarkdownLintPortResult {
    if (this.#isDestroyed()) return { status: "destroyed" };
    if (!this.#enabled) return { status: "noop" };
    recomputeViewMarkdownLint(this.#getView());
    return { status: "applied" };
  }
}
