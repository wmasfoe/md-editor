# 编辑器模式切换与 AI 流式生命周期治理规范

> 状态：CodeMirror 6 与 AI Provider 当前契约。v0.10.1 验证通过（PR #58）；落实 noop 幂等切换、模式切换主动中断 AI 续写与清理幽灵建议。

## 用途

记录编辑器在 WYSIWYG 与 Source 模式切换时的状态机流转规则、并发防重入保护，以及与外部异步服务（AI 续写流、Ghost Suggestion）的生命周期解耦契约。修改 `packages/editor-core/src/document-state.ts`、`apps/desktop/src/app/controller/useDocumentActionsController.ts` 或 `packages/renderer-codemirror/src/wysiwyg/suggestion.ts` 前先读本规范。

---

## 核心不变量

### 1. `switchEditorModeSafely` 模式幂等性契约

- 当调用方请求的目标渲染模式（`targetMode`）与编辑器当前模式相同时，渲染器将返回 `noop`（表示无状态变更）。
- 核心状态层（`packages/editor-core/src/document-state.ts`）必须将 `noop` 视为合法的幂等成功，直接返回成功状态，**严禁**上抛异常（历史缺陷：连续快速点击导致 UI 抛出 `Renderer mode change failed: noop` 导致崩溃）。

```typescript
// 模式切换幂等状态判定
if (rendererResult.kind === "noop") {
  return {
    kind: "applied",
    mode: targetMode,
  };
}
```

### 2. AI 流式请求主动熔断契约

- 模式切换是渲染层 extensions 与 DOM 树的彻底重构。
- 应用层控制器在进入 `switchMode` 时，必须立即调用活跃 AI 续写流的 `AbortController.abort()`：
  ```typescript
  activeAiContinuationRef.current?.abort();
  activeAiContinuationRef.current = null;
  ```
- 严禁允许在旧渲染模式下发起的流式异步生成在切入新模式后继续写入，防止跨模式并发更新破坏 CM6 的文档事务与选区。

### 3. 幽灵建议 (Ghost Suggestion) 物理清理契约

- 渲染器（`packages/renderer-codemirror/src/wysiwyg/suggestion.ts`）在模式发生切换时，必须主动清除视图内活动的所有 AI 建议装饰（Decoration）：
  ```typescript
  // 模式切换时清空建议浮层与内联 ghost text
  view.dispatch({
    effects: clearSuggestionEffect.of(null),
  });
  ```
- 严禁将 WYSIWYG 模式下的虚拟投影残留到 Source 模式，避免源码视图显示虚假幽灵文字或在 Range 映射时引发越界。

### 4. 模式切换并发互斥保护锁 (`isSwitchingModeRef`)

- 模式切换包含异步表格脏数据刷新（`flushPendingEdits`）、CM6 状态重配及 React UI 状态提交，必须具备并发互斥保护。
- 控制器必须维护一个跨渲染周期的互斥锁引用 `isSwitchingModeRef`：
  - 进入 `switchMode` 时，若 `isSwitchingModeRef.current === true`，则立即返回放弃当前调用；
  - 标记 `isSwitchingModeRef.current = true`，并在 `try / finally` 块的 `finally` 中可靠释放；
  - 杜绝用户高频连续狂点模式切换按钮导致的状态撕裂与渲染重入。
