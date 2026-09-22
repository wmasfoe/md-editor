/**
 * @file tab-arbiter.ts
 * @description 统一 Tab arbiter 的**纯决策函数**（D-MB：R1 属主选定方案 (b)）。
 *
 * ## 设计动机（终局 code-review HIGH：T13「数组位置 ≠ 派发顺序」）
 *
 * 此前 Tab 仲裁分散在 4 个独立 keymap：`aiSuggestionKeymap`、`codeBlockKeymap`、
 * `bracketEscapeKeymap`、结构化 keymap。注册顺序（`wysiwyg/index.ts` 的数组位置）
 * 被误当派发顺序 —— 实际上 `bracketEscapeKeymap` 未包 `Prec.highest`，而其余三个都是，
 * 于是括号跳出被 `Prec` 排到**最后**，与它自己注释声称的次序正好相反（H3 根因）。
 *
 * 修法：**Tab 次序收敛为本文件的一个纯函数**，CM6 keymap 与表格 DOM keydown 都是
 * 薄派发器（`tab-arbiter-command.ts` / `table-widget.ts`），各自按本函数给出的顺序
 * 调度执行器。次序由构造不可漂移；两套事件系统**语义单一**。
 *
 * ## D2 全序（deep-interview 逐态确认 + I9 断言顺序）
 *
 * 1. **IME 组合期** → `[]`（放行原生，铁律第 1 步「瞬时模态态 > 结构语义」）
 * 2. `accept-suggestion`（有激活建议时；执行器自门控覆盖范围）
 * 3. `code-block`（仅非表格上下文；执行器自门控是否在代码块内）
 * 4. `escape-bracket`（执行器自门控：位置分流 / 边界 fail closed / 多光标切片）
 * 5. 尾部：CM6 → `structured`（表格跳格 / 列表层级），表格 → `table-next-cell`
 *
 * 执行器（acceptAiSuggestion / codeBlockTab / escapeBracket / structuredTab）**保留
 * 自门控**（返回 false 继续）：本函数决定**谁有资格以什么顺序出场**，
 * 执行器决定**自己在当前 state 下是否动作**。两层职责不重叠。
 */

/** Tab 决策产出的动作标识（按 D2 全序排列） */
export type TabAction =
  "accept-suggestion" | "code-block" | "escape-bracket" | "structured" | "table-next-cell";

/**
 * 决策所需的全部上下文 —— 只含布尔事实，由**派发器**（接入层）从各自协议里取出：
 * CM6 从 `view` / StateField 读；表格 DOM 从 `keyEvent.isComposing` 与 AI 建议字段读。
 * 类型上不存在 view / DOM 节点 → 纯函数不可触碰派发细节（架构边界）。
 */
export interface TabArbiterContext {
  /** IME / 组合输入进行中（铁律第 1 步） */
  readonly composing: boolean;
  /** 当前存在激活的 AI 建议（执行器仍自门控「是否覆盖光标」） */
  readonly suggestionActive: boolean;
  /** 表格单元格上下文（DOM keydown 腿）；CM6 腿恒为 false（DOM 拦截先于 keymap） */
  readonly inTableCell: boolean;
}

/**
 * **纯决策函数**：返回按 D2 全序排好的、当前有资格出场的执行器序列。
 *
 * - `composing` → `[]`：派发器不得再调度任何 Tab 执行器（放行原生）。
 * - 表格上下文**跳过** `code-block`（单元格内无围栏代码块语义），
 *   尾部换成 `table-next-cell`（跳下一格 / flushCellCommit）。
 * - `code-block` 与 `escape-bracket` 始终在场（执行器自门控），保证
 *   「顺序」是本函数的**单一定义点** —— 任何上下文下相对次序都不可被调换。
 */
export function decideTabActions(context: TabArbiterContext): readonly TabAction[] {
  if (context.composing) {
    return [];
  }
  const actions: TabAction[] = [];
  if (context.suggestionActive) {
    actions.push("accept-suggestion");
  }
  if (!context.inTableCell) {
    actions.push("code-block");
  }
  actions.push("escape-bracket");
  actions.push(context.inTableCell ? "table-next-cell" : "structured");
  return actions;
}

/**
 * 不再各自实现迭代 —— 序列归属本模块，dispatcher 只提供「动作 → 执行器」映射，
 * 消除双份 for-loop 的映射漂移。
 *
 * @returns `handled` = 某执行器返回 true（dispatcher 应就地收尾）；
 *          `fallthrough` = 序列走完无人消费（dispatcher 执行自己的尾动作，
 *          如表格的 flushCellCommit+跳格、CM6 的返回 false 交还 keymap）。
 *
 * **尾契约**（轮2 architect 反方论点处置）：两侧尾内容按系统相异是**设计**而非漂移 ——
 * 对齐义务仅一条：都必须在 `fallthrough` 分支内完成自己的尾并**在两侧注释互指本函数**；
 * runner 单测锁定 fallthrough 行为（tab-arbiter.test.ts “共享 runner”组）。
 */
export function dispatchTabActions(
  context: TabArbiterContext,
  executors: Partial<Record<TabAction, () => boolean>>,
): "handled" | "fallthrough" {
  for (const action of decideTabActions(context)) {
    if (executors[action]?.()) {
      return "handled";
    }
  }
  return "fallthrough";
}
