import { Facet, type EditorState } from "@codemirror/state";

/**
 * @file engine.ts
 * @description Markdown lint 引擎的宿主端口（**按实例注入**，无全局状态）。
 *
 * 编辑器不再 `import "markdownlint/sync"`：那是 1.2 MB + 42 个传递包，会让"只渲染
 * Markdown"的宿主（官网演示、移动端、QuickLook）也背着它。
 *
 * 为什么注入而不是动态导入：lint 调用点在**同步**路径上（诊断要在一次事务里同步产出），
 * 改 `await import` 会把 `runMarkdownLintCommand` / `fixAllMarkdownLint` 变成 async，
 * 波及所有宿主与第三方调用方。注入保持同步，同时让"用不到就不装"成立。
 *
 * 形状刻意与 `markdownlint` 的真实导出对齐，宿主可直接
 * `markdownlint={{ lint }}`；需要读 `.markdownlint.json` 或官方 fix 时再补
 * `readConfig` / `applyFixes`，仍然是同一个 prop。
 */

/**
 * markdownlint 单条问题的最小结构（我们实际读取的字段）。
 *
 * **可空性必须与官方 `LintError` 一致**，否则 README 推荐的
 * `markdownlint={{ lint }}` 在严格模式下会报 TS2322，宿主只能写
 * `as unknown as` —— 那等于文档示例不可用。
 *
 * 官方定义（`markdownlint@0.42` 的 `LintError`）：
 * - `errorDetail` / `errorContext`: `string | null`
 * - `errorRange`: `number[] | null`（**不是**定长元组）
 * - `fixInfo`: `FixInfo | null`
 * - `severity`: `"error" | "warning"`（必填）
 *
 * 我们保留 `?` 是为了兼容那些不产出这些字段的轻量引擎实现，
 * 但**类型里必须包含 `null`**，才能接住官方返回值。
 */
export interface MarkdownLintIssue {
  readonly lineNumber: number;
  readonly ruleNames: readonly string[];
  /** 官方必填；缺省时调用方按 warning 处理。 */
  readonly severity?: "error" | "warning";
  readonly ruleDescription?: string;
  readonly errorDetail?: string | null;
  readonly errorContext?: string | null;
  readonly errorRange?: readonly number[] | null;
  readonly fixInfo?: MarkdownLintFixInfo | null;
}

/** 修复指令（与官方 `FixInfo` 对齐）。 */
export interface MarkdownLintFixInfo {
  readonly lineNumber?: number;
  readonly editColumn?: number;
  readonly deleteCount?: number;
  readonly insertText?: string;
}

/**
 * lint 请求：官方的 `Options` 里我们只依赖这两个字段。
 *
 * 刻意**不用 `Readonly`** 包裹 `strings`/`config`：官方 `Options.strings` 是
 * 可变 `Record<string, string>`，用 `Readonly` 会让官方函数不可赋值给我们
 * （函数参数逆变）。可读性由调用方自觉维持，类型层不做多余约束。
 */
export interface MarkdownLintRequest {
  strings: Record<string, string>;
  config?: Record<string, unknown>;
}

/** 官方 `LintResults` 是 `{ [k: string]: LintError[] }`（可变）。 */
export type MarkdownLintResult = Record<string, MarkdownLintIssue[]>;

/**
 * 宿主注入的引擎能力。只有 `lint` 是必需的。
 *
 * ```ts
 * import { lint } from "markdownlint/sync";
 * <CodeMirrorEditor markdownlint={{ lint }} />
 * ```
 */
export interface MarkdownLintEngine {
  readonly lint: (request: MarkdownLintRequest) => MarkdownLintResult;
  /**
   * 读配置文件（官方 `readConfig(file, parsers?, fs?)`）。
   *
   * 参数形状用 `never[]` 而非具体元组：官方签名有三个可选位置参数，
   * 用固定形状会因参数逆变而无法赋值。调用方只需知道"能传、返回未知配置"。
   */
  readonly readConfig?: (...args: never[]) => unknown;
  /** 应用修复（官方 `applyFixes(input, errors)`）。 */
  readonly applyFixes?: (input: string, errors: MarkdownLintIssue[]) => string;
}

/**
 * 引擎 Facet：让**任何持有 `EditorState` 的路径**（实时 lint 防抖、快速修复后的刷新）
 * 都能拿到同一个引擎，而不是靠调用方逐层传参——后者的直接后果就是漏传即静默失效。
 */
export const markdownLintEngineFacet = Facet.define<
  MarkdownLintEngine | undefined,
  MarkdownLintEngine | undefined
>({
  combine: (values) => values[0],
});

/** 解析引擎：显式参数优先，其次 state 上的 facet。 */
export function resolveMarkdownLintEngine(
  state: EditorState,
  explicit?: MarkdownLintEngine,
): MarkdownLintEngine {
  return requireMarkdownLintEngine(explicit ?? state.facet(markdownLintEngineFacet));
}

/** 取引擎；未注入时抛带修复指引的错误（不静默降级）。 */
export function requireMarkdownLintEngine(
  engine: MarkdownLintEngine | undefined,
): MarkdownLintEngine {
  if (!engine) {
    throw new Error(
      "Markdown lint engine is not configured. Install `markdownlint` and pass it to the editor: " +
        "<CodeMirrorEditor markdownlint={{ lint }} /> (or `markdownlint: { lint }` on the bridge).",
    );
  }
  return engine;
}
