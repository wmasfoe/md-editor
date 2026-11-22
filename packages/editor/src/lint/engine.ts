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

/** markdownlint 单条问题的最小结构（我们实际读取的字段）。 */
export interface MarkdownLintIssue {
  readonly lineNumber: number;
  readonly ruleNames: readonly string[];
  /** 部分版本会带 severity；缺省按 warning 处理。 */
  readonly severity?: string;
  readonly ruleDescription?: string;
  readonly errorDetail?: string;
  readonly errorContext?: string;
  readonly errorRange?: readonly [number, number];
  readonly fixInfo?: {
    readonly lineNumber?: number;
    readonly editColumn?: number;
    readonly deleteCount?: number;
    readonly insertText?: string;
  };
}

export interface MarkdownLintRequest {
  readonly strings: Readonly<Record<string, string>>;
  readonly config?: Readonly<Record<string, unknown>>;
}

export type MarkdownLintResult = Readonly<Record<string, readonly MarkdownLintIssue[]>>;

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
  readonly readConfig?: (options: {
    readonly config?: unknown;
    readonly configDefault?: unknown;
  }) => unknown;
  readonly applyFixes?: (input: string, errors: readonly unknown[]) => string;
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
