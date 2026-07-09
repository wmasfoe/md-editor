# Desktop Editor Actions Context

用途：规范 Provider 依赖型桌面动作的组织方式，作为 `desktop_store_controller_boundary.md` 的补充实现细节。改动 `DesktopEditorActionsContext`、bridge、store 注入逻辑时先读本文。

## 问题背景

`useDocumentUiStore` 历史上承担了两类混合职责：

1. **真实 UI 状态**：`hasActiveDocument`、`openedAsset`、`commitMarkdown` 等，store 初始化时依赖 module-level 单例即可实现。
2. **Provider 依赖型动作**：`dispatchCommand`、`openWysiwygLink`、`runEditorUpdateAction`、`openDocumentFromTree`、`openRecentFile`——这些需要 `useEditorUiActions()`（editor-ui Provider）或 `useAppSettings()`（settings context）才能构造。

这导致了 `createMissingBridgeAction` 占位模式：store 里放 no-op stub，对应的 bridge hook 在挂载后通过 `useLayoutEffect → setState` 替换真实实现。这是 `desktop_store_controller_boundary.md` 明确反对的反模式——"store 看起来是行为主人，实际只是 no-op 占位，真实逻辑藏在 controller 生命周期里"。

## 解决方案

所有消费端组件（`MainApp`、`FileTreePanel`、`DesktopMilkdownEditor`、`EditorTitleBarControls`）本就在 `EditorUiProvider` 和 `AppSettingsProvider` 内部，可以直接访问 hook。用 **React Context** 代替 zustand 注入：

- `useDesktopEditorController` 内联原 bridge 逻辑，**返回** action 函数集合（不再注入 store）。
- `DesktopEditorEffects` 从无输出组件变为 Context Provider，把 controller 返回值通过 `DesktopEditorActionsContext` 传给子树。
- 消费端通过 `useDesktopEditorActions()` 读取，不再从 `useDocumentUiStore` 读取 Provider 依赖型动作。

## 组件树

```
AppSettingsProvider
└─ DesktopEditorUiProvider
    └─ DesktopEditorEffects (= DesktopEditorActionsContext.Provider)
        ├─ [lifecycle effects: keyboard / menu / window / paste / drop]
        └─ MainApp
```

## 哪些动作属于 Context，哪些留在 Store

| 动作 | 归属 | 原因 |
|------|------|------|
| `dispatchCommand` | Context | 需要 `useEditorUiActions().getEditorCommands` |
| `openWysiwygLink` | Context | 需要 `jumpToMarkdownFragment`（editor-ui） |
| `runEditorUpdateAction` | Context | 需要 `useAppSettings()` hooks |
| `openDocumentFromTree` | Context | 需要 `documentActions`（含 discard 检查） |
| `openRecentFile` | Context | 同上 |
| `commitMarkdown` | Store | 只依赖 `runtime` 单例，初始化时即可实现 |
| `resolveImageSrc` | Store | 同上 |
| `openAssetPath` / `closeAssetPreview` | Store | 纯 store 状态操作 |
| `hasActiveDocument` / `openedAsset` | Store | UI 状态 |

## 不要再做的事

- 不要在 store 里放 `createMissingBridgeAction` 占位。
- 不要通过 `useLayoutEffect → useXxxStore.setState(...)` 注入 Provider 依赖型函数。
- 不要新增 bridge hook（如 `useDesktopXxxBridge`）再走注入路径；如果动作需要 Provider 能力，直接在 `useDesktopEditorController` 中构造并通过 context 暴露。

## 新增动作的流程

1. 在 `DesktopEditorActionsContext.tsx` 的 `DesktopEditorActions` 接口里添加方法签名。
2. 在 `useDesktopEditorController.ts` 里用现有 hook 依赖构造实现，加入返回值。
3. 消费组件通过 `useDesktopEditorActions()` 读取。
