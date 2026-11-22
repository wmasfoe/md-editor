/**
 * @file markdown-lint.ts
 * @description 编辑器侧的 lint 状态机：开关、引擎、重算。
 *
 * 引擎可以在**运行时late-arrive**（宿主把 markdownlint 改成动态 import 后，引擎会比视图晚到），
 * 因此引擎单独占一个 compartment：到达后只需 reconfigure 一次 facet，不必重建视图。
 */
import { Compartment, Transaction, type StateEffect } from "@codemirror/state";

import { markdownLintEngineFacet, type MarkdownLintEngine } from "../../lint/engine.ts";
import { createRealtimeMarkdownLintExtension } from "../../lint/index.ts";
import { rendererTransactionOrigin } from "../../origin.ts";
import type { MarkdownLintPortResult, MarkdownLintTarget, RendererViewAdapter } from "../types.ts";
import { createMarkdownLintClearEffects, recomputeViewMarkdownLint } from "./view-operations.ts";

export interface MarkdownLintControllerOptions {
  readonly enabled: boolean;
  readonly engine: MarkdownLintEngine | undefined;
  readonly getView: () => RendererViewAdapter;
  readonly isDestroyed: () => boolean;
}

/** 两个引擎在行为上是否等价（比较函数身份，不比较外层对象）。 */
function isSameEngine(
  next: MarkdownLintEngine | undefined,
  current: MarkdownLintEngine | undefined,
): boolean {
  if (next === current) return true;
  if (!next || !current) return false;
  return (
    next.lint === current.lint &&
    next.readConfig === current.readConfig &&
    next.applyFixes === current.applyFixes
  );
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

  /** 当前配置快照（测试与宿主自检用）。 */
  get state(): MarkdownLintTarget {
    return { engine: this.#engine, enabled: this.#enabled };
  }

  setEnabled(enabled: boolean): MarkdownLintPortResult {
    return this.configure({ engine: this.#engine, enabled });
  }

  /**
   * 运行期注入/替换引擎（宿主动态 import 完成后调用）。
   *
   * 委托给 {@link configure}：引擎与开关永远一起校验、一起提交。
   */
  setEngine(engine: MarkdownLintEngine | undefined): MarkdownLintPortResult {
    return this.configure({ engine, enabled: this.#enabled });
  }

  /**
   * 原子提交 `{ engine, enabled }`。
   *
   * 为什么必须原子：宿主的两个 effect 先后到达时（先撤引擎、再按旧开关启用），
   * 中间态是「开关 true + 无引擎」——既非法又会让校验抛错。把目标组合一次性
   * 交进来，就不存在这个中间态。
   *
   * 顺序契约：
   * 1. **先校验目标组合**（开启但无引擎 → 抛错），此时尚未产生任何副作用；
   * 2. 校验通过后才派发**单个事务**（引擎 facet + 实时 lint 扩展一起 reconfigure）；
   * 3. 事务成功后才更新控制器字段，保证"状态 === 已应用配置"。
   *
   * 任一环节失败，控制器与视图都保持调用前的配置（无半提交）。
   */
  configure(target: MarkdownLintTarget): MarkdownLintPortResult {
    if (this.#isDestroyed()) return { status: "destroyed" };

    const engineChanged = !isSameEngine(target.engine, this.#engine);
    const enabledChanged = target.enabled !== this.#enabled;
    if (!engineChanged && !enabledChanged) return { status: "noop" };

    // 1) 先校验：非法组合在产生任何副作用之前就失败。
    if (target.enabled && !target.engine) {
      throw new Error(
        "Cannot enable markdown lint: no `markdownlint` engine was injected when the editor was created.",
      );
    }

    // 2) 单事务提交：引擎 facet 与实时 lint 扩展一起生效。
    const view = this.#getView();
    const effects: StateEffect<unknown>[] = [];
    if (engineChanged) {
      effects.push(this.engineCompartment.reconfigure(markdownLintEngineFacet.of(target.engine)));
    }
    if (enabledChanged || engineChanged) {
      effects.push(
        this.compartment.reconfigure(createRealtimeMarkdownLintExtension(target.enabled)),
      );
    }
    if (!target.enabled) {
      effects.push(...createMarkdownLintClearEffects(view.state));
    }
    if (effects.length > 0) {
      view.dispatch({
        effects,
        annotations: [
          Transaction.addToHistory.of(false),
          rendererTransactionOrigin.of({ kind: "markdown-lint" }),
        ],
      });
    }

    // 3) 事务成功后才落状态。
    this.#engine = target.engine;
    this.#enabled = target.enabled;
    return { status: "applied" };
  }

  recompute(): MarkdownLintPortResult {
    if (this.#isDestroyed()) return { status: "destroyed" };
    if (!this.#enabled) return { status: "noop" };
    recomputeViewMarkdownLint(this.#getView());
    return { status: "applied" };
  }
}
