# 可复用 Hooks 迁移到 editor-core 方案

## 背景

随着 web 端开发启动，需要将当前散落在 `apps/desktop/src/app/controller/` 下的、与平台无关的 React hooks 迁移到 `packages/editor-core`，让各端共享同一套编辑器状态逻辑。

---

## 当前状态

### 需要迁移的 hooks

| Hook | 当前位置 | 迁移难度 | 说明 |
|------|---------|---------|------|
| `useOutlineController` | `apps/desktop/.../controller/` | 中 | 依赖 `TocTarget`（来自 `editor-ui`），需先搬类型 |
| `useConfirmationController` | `apps/desktop/.../controller/` | 中 | 依赖 `ConfirmationChoice/State`（来自 `editor-ui`） |
| `useFileActionController` | `apps/desktop/.../controller/` | 低 | 无外部包依赖，直接迁移 |
| `formatActionError` | `apps/desktop/.../controller/` | 低 | 工具函数，随 `useFileActionController` 一起迁 |
| `useMdxAiController` | `apps/desktop/.../controller/` | 中 | 依赖 `runtime` 单例，需改为参数注入 |

### 留在桌面端的 hooks

| Hook | 原因 |
|------|------|
| `useFileTreeController` | 依赖 `fileService`（Tauri 文件系统） |
| `useDocumentActionsController` | 依赖 `fileService`，含大量 Tauri 文件操作 |
| `useDesktopEditorController` | 桌面端特有协调层，依赖 Tauri 窗口/菜单 API |

---

## 核心问题

### 1. 循环依赖

`editor-core` 当前不能引入 `editor-ui`，因为 `editor-ui` 已经依赖 `editor-core`：

```
editor-ui  →  editor-core        ← 现状，正常
editor-core →  editor-ui          ← 若 hooks 直接引入 editor-ui 的类型，会循环
```

`useOutlineController` 需要 `TocTarget`（来自 `editor-ui`），`useConfirmationController` 需要 `ConfirmationChoice` / `ConfirmationState`（来自 `editor-ui`）。

**解法**：把这三个类型从 `editor-ui` 搬到 `editor-core`，`editor-ui` 再从 `editor-core` re-export 保持向后兼容。

### 2. editor-core 含 Tauri 依赖

`packages/editor-core/src/recent-files.ts` 里的 `createTauriRecentFilesBackend()` 动态 import 了 `@tauri-apps/api/core`，导致 `editor-core` 目前不是真正平台无关的包。

**解法**：在 `editor-core` 中只保留接口 `RecentFilesBackend` 和内存实现。`createTauriRecentFilesBackend` 移至 `apps/desktop`，由桌面端在初始化时注入。`@tauri-apps/api` 从 `editor-core` 的依赖中移除。

### 3. useMdxAiController 依赖 runtime 单例

```ts
// 现状：直接引用桌面端单例
import { runtime } from "../runtime/editor-runtime";
const mdxComponentPlugins = useMemo(() => runtime.mdxComponents.listInsertable(), []);
```

**解法**：改为参数注入，调用方传入获取插件的函数。

---

## 迁移后的目录结构

```
packages/editor-core/
  src/
    hooks/                          ← 新增目录
      useOutlineController.ts       ← 从 desktop 迁入
      useConfirmationController.ts  ← 从 desktop 迁入
      useFileActionController.ts    ← 从 desktop 迁入（含 formatActionError）
      useMdxAiController.ts         ← 从 desktop 迁入，runtime 改为参数
    toc.ts                          ← TocTarget 类型（从 editor-ui 迁入）
    confirmation.ts                 ← ConfirmationChoice/State（从 editor-ui 迁入）
    recent-files.ts                 ← 移除 createTauriRecentFilesBackend

packages/editor-ui/
  src/
    index.ts                        ← re-export TocTarget/ConfirmationXxx from editor-core（保持兼容）

apps/desktop/
  src/
    desktop/
      recent-files-tauri-backend.ts ← 从 editor-core 移出的 Tauri backend 实现
    controller/
      useFileTreeController.ts      ← 保留（Tauri 专属）
      useDocumentActionsController.ts ← 保留（Tauri 专属）
      useDesktopEditorController.ts   ← 保留（桌面端协调层）
```

---

## 具体变更

### Step 1：类型迁移（editor-ui → editor-core）

在 `packages/editor-core/src/` 新增两个类型文件：

```ts
// toc.ts
export interface TocTarget {
  readonly line: number;
  readonly level: number;
  readonly text: string;
  readonly nonce: number;
}
```

```ts
// confirmation.ts
export type ConfirmationChoice = "confirm" | "secondary" | "cancel";

export interface ConfirmationState {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  readonly secondaryLabel?: string;
  readonly destructive?: boolean;
}
```

在 `editor-ui/src/index.ts` 加 re-export（不破坏现有导入路径）：
```ts
export type { TocTarget } from "@md-editor/editor-core";
export type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-core";
```

### Step 2：recent-files.ts 去 Tauri 化

从 `packages/editor-core/src/recent-files.ts` 中移除：
- `createTauriRecentFilesBackend` 函数
- `@tauri-apps/api` 的动态 import
- `createRecentFilesStore()` 默认参数中对 Tauri backend 的引用（改为默认 `null`）

迁移到 `apps/desktop/src/desktop/recent-files-tauri-backend.ts`，由桌面端初始化时显式传入：
```ts
// apps/desktop/src/desktop/recent-files-tauri-backend.ts
export function createTauriRecentFilesBackend(): RecentFilesBackend { ... }

// apps/desktop 使用处
export const recentFilesStore = createRecentFilesStore(createTauriRecentFilesBackend());
```

### Step 3：useMdxAiController 参数化

将 `getMdxComponentPlugins` 改为注入参数：

```ts
// packages/editor-core/src/hooks/useMdxAiController.ts
interface UseMdxAiControllerOptions {
  readonly aiSettings: AiSettings;
  readonly getEditorMode: () => EditorMode;
  readonly getMdxComponentPlugins: () => readonly MdxComponentPlugin[]; // 新增
  readonly showToast: (message: string | null) => void;
}
```

桌面端调用处调整：
```ts
// DesktopMilkdownEditor.tsx
useMdxAiController({
  aiSettings: settings.ai,
  getEditorMode,
  getMdxComponentPlugins: () => runtime.mdxComponents.listInsertable(),
  showToast,
});
```

### Step 4：editor-core 加 React peer dependency

```json
// packages/editor-core/package.json
{
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "dependencies": {
    "@md-editor/markdown-fidelity": "workspace:*",
    "@md-editor/mdx-component-registry": "workspace:*",
    "@md-editor/shared": "workspace:*"
    // 移除 @tauri-apps/api
  }
}
```

---

## 依赖图（迁移后）

```
shared
  ↑
editor-core (含 hooks、TocTarget、ConfirmationXxx)
  ↑              ↑
editor-ui      markdown-fidelity
  ↑
apps/desktop  (含桌面端 hooks、Tauri backend、coordinator)
apps/web      (含 web 端 hooks、browser backend、coordinator)
```

---

## 文件变更清单

| 操作 | 文件路径 |
|------|---------|
| 新增 | `packages/editor-core/src/toc.ts` |
| 新增 | `packages/editor-core/src/confirmation.ts` |
| 新增 | `packages/editor-core/src/hooks/useOutlineController.ts` |
| 新增 | `packages/editor-core/src/hooks/useConfirmationController.ts` |
| 新增 | `packages/editor-core/src/hooks/useFileActionController.ts` |
| 新增 | `packages/editor-core/src/hooks/useMdxAiController.ts` |
| 修改 | `packages/editor-core/src/index.ts` — 导出新增类型和 hooks |
| 修改 | `packages/editor-core/src/recent-files.ts` — 移除 Tauri backend |
| 修改 | `packages/editor-core/package.json` — 加 React peer dep、移除 @tauri-apps/api |
| 修改 | `packages/editor-ui/src/index.ts` — re-export 迁移的类型 |
| 新增 | `apps/desktop/src/desktop/recent-files-tauri-backend.ts` |
| 修改 | `apps/desktop/src/app/controller/useDesktopEditorController.ts` — 更新 import 路径 |
| 修改 | `apps/desktop/src/components/DesktopMilkdownEditor.tsx` — 传入 `getMdxComponentPlugins` |
| 删除 | `apps/desktop/src/app/controller/useOutlineController.ts`（迁移后） |
| 删除 | `apps/desktop/src/app/controller/useConfirmationController.ts`（迁移后） |
| 删除 | `apps/desktop/src/app/controller/useFileActionController.ts`（迁移后） |
| 删除 | `apps/desktop/src/app/controller/useMdxAiController.ts`（迁移后） |
| 删除 | `apps/desktop/src/app/controller/controller-errors.ts`（随 useFileActionController 迁移） |

---

## 注意事项

- **`useFileActionController` 的 `showToast` 参数**：这个 hook 只需要 `showToast`，没有任何平台依赖，是最干净的迁移对象。
- **`useConfirmationController` 里的 Promise + useRef 模式**：这个模式本身是平台无关的，迁移时不需要改逻辑。
- **React 不是 editor-core 的现有依赖**：Step 4 的 peer dependency 是必须的前置步骤，否则 hooks 里的 `useCallback`/`useState` 无法解析。
- **迁移时保持 hooks 签名不变**（除 `useMdxAiController` 加 `getMdxComponentPlugins` 外），桌面端只需更新 import 路径。
