/**
 * @file coverage.ts
 * @description 解析覆盖度（`MarkdownParseCoverage`）的投影与推导策略。
 *
 * 从 `range-index.ts` 抽出：该文件已触及 renderer 的 800 行硬上限
 * （见 `scripts/structure/check.mjs`），而覆盖度语义是独立且需要单独解释的一块。
 *
 * ## 核心契约：覆盖度必须与「实际用于建索引的那棵树」同源
 *
 * CodeMirror 的语法树有**两个不同步的视图**，这是本模块所有坑的根源：
 *
 * | 来源 | 含义 |
 * |---|---|
 * | `syntaxTree(state)` | `LanguageState.tree` —— 在 `EditorState.update` 期间由 `takeTree()` 截下的**快照** |
 * | `ensureSyntaxTree(state, n)` | 推进 `LanguageState.context` 并返回**新树**；**不会**更新上面的快照 |
 * | `syntaxTreeAvailable(state, n)` | 读 `context.isDone(n)` —— 看的是**已推进**的 context |
 *
 * 因此「`syntaxTree(state).length` + `syntaxTreeAvailable(...)`」是**两种不同步的视图混用**：
 * `LanguageState` 初始化时只解析 `Work.InitViewport`（约 3000 字符），
 * `ensureSyntaxTree` 把 context 推进到全文后，快照仍停在约 3000 ——
 * 于是 `coverage.to ≈ 3000` 却 `complete: true`，其后所有记录的
 * `parserCoverage` 被误判成 `partial`，标题/表格/代码块/列表投影集体退化为源码。
 *
 * 结论：**覆盖度只能从调用方真正拿去建索引的那棵树推导**（见 {@link coverageOfTree}），
 * 不得在本模块内部二次读取 `syntaxTree()` 或 `syntaxTreeAvailable()`。
 */
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import type { MarkdownParseCoverage } from "@md-editor/plugin-sdk/syntax";

/**
 * 由**权威语法树**推导覆盖度（纯函数）。
 *
 * `tree` 必须是调用方实际用于 `buildMarkdownRangeIndex` 的那棵 ——
 * 通常是 `ensureSyntaxTree(...)` 的返回值，而不是 `syntaxTree(state)` 快照。
 */
export function coverageOfTree(tree: Tree, documentLength: number): MarkdownParseCoverage {
  const to = Math.min(tree.length, documentLength);
  return Object.freeze({ to, complete: to >= documentLength });
}

/**
 * 增量更新路径的覆盖度投影。
 *
 * ## 为什么不能直接重新测量
 *
 * 普通打字不再 `ensureSyntaxTree`，`syntaxTree(state)` 在变更区域之外可能仍是旧的、
 * 未随文档增长的快照。刚编辑完时 `tree.length` 常落后于 `doc.length`，无脑重新测量
 * 会把本该完整的覆盖度误判为 `partial`，进而把 `parserCoverage` 降级。
 *
 * 也不能只把旧 `to` 按变更平移：`coverage.to` 记录的是「被实际遍历过的语法树范围」，
 * 而增量路径不再遍历全文，平移值永远追不上文档增长（实测 3019 vs 8080）。
 *
 * ## 为什么必须核对 `syntaxTreeAvailable`
 *
 * 「上一轮完整 ⇒ 这一轮仍完整」只在**语法树确实重新覆盖了全文**时成立。
 * `LanguageState.apply` 对每次编辑只给 20ms 预算（`Work.Apply`），超时即
 * `takeTree()` 在 `parsedPos` 处截断。此时 `tree.length < doc.length`：
 *
 * - `getTopLevelRanges()` 只覆盖到截断点，`newDirty` 无法扩到截断点之后；
 * - 截断点之后的旧记录被 `mapRecord` 原样保留（指纹未变、映射也合法）；
 * - 但那段源码的**结构可能已经整体失效**（如在文首输入 `<!--` 让后文全变注释）。
 *
 * 若此时仍声明 `complete: true`，`parse-progress.ts` 的 `parseCoverageAdvanced()`
 * 两个条件（`tree.length > coverage.to` 与 `!coverage.complete`）都不成立，
 * 后台解析补齐后**永不**派发 `refreshMarkdownParseCoverageEffect` ——
 * 过期记录永久残留。因此截断时必须如实报告 `partial` + 真实截断位置。
 *
 * 这里用 `syntaxTreeAvailable` 是刻意的：增量路径判断的是「context 是否已推进到全文」，
 * 正是该函数语义；而 `to` 取自快照本身，二者在**这个分支**下是一致的
 * （上下文落后 ⇒ 两者都落后，结论是 `partial`，不影响正确性）。
 */
export function projectCoverage(
  previous: MarkdownParseCoverage,
  state: EditorState,
): MarkdownParseCoverage {
  const documentLength = state.doc.length;
  // 上一轮本就不完整：保持不完整，`to` 不前进。
  if (!previous.complete) {
    return Object.freeze({ to: Math.min(previous.to, documentLength), complete: false });
  }
  // 上一轮完整，且这一轮语法树确实覆盖全文 ⇒ 增量更新后仍然完整。
  if (syntaxTreeAvailable(state, documentLength)) {
    return Object.freeze({ to: documentLength, complete: true });
  }
  // 上一轮完整，但这一轮语法树被解析预算截断 ⇒ 如实报告 partial。
  // `to` 取当前快照的真实深度（诚实值）；`complete: false` 会让
  // `parseCoverageAdvanced()` 的 `currentComplete && !coverage.complete` 成立，
  // 后台解析补齐后必定触发一次全量刷新。
  return Object.freeze({
    to: Math.min(syntaxTree(state).length, documentLength),
    complete: false,
  });
}
