# Hooks 迁移到 editor-core 完整操作手册

> **目标读者**：执行迁移的 AI Agent  
> **目标**：将 `apps/desktop/src/app/controller/` 下与平台无关的 React hooks 迁移到 `packages/editor-core`，使 web 端和未来其他端可以直接复用。  
> **完成后验收标准**：`pnpm typecheck` 和 `pnpm test` 在所有包中零错误通过。

---

## 1. 背景与范围

### 需要迁移的文件

| 源文件（`apps/desktop/src/app/controller/`） | 目标（`packages/editor-core/src/hooks/`） |
|------|------|
| `useOutlineController.ts` | `useOutlineController.ts` |
| `useConfirmationController.ts` | `useConfirmationController.ts` |
| `useFileActionController.ts` | `useFileActionController.ts` |
| `controller-errors.ts` | `controller-errors.ts`（随 useFileActionController 一起迁） |
| `useMdxAiController.ts` | `useMdxAiController.ts`（需改造，见第 6 步） |

### 保留在桌面端的文件（不迁移）

- `useFileTreeController.ts` — 依赖 `fileService`（Tauri 文件系统）
- `useDocumentActionsController.ts` — 依赖 `fileService`，含 Tauri 文件操作
- `useDesktopEditorController.ts` — 桌面端特有协调层，依赖 Tauri 窗口/菜单 API
- `useSettingsController.ts` — 依赖桌面端设置 API

---

## 2. 当前依赖图与循环依赖分析

```
packages/shared
      ↑
packages/editor-core  ←── 当前含 @tauri-apps/api（需清理）
      ↑
packages/editor-ui    ←── 含 TocTarget、ConfirmationChoice/State 定义
      ↑
apps/desktop
```

### 两个核心障碍

**障碍 A：循环依赖**

`useOutlineController` 需要 `TocTarget`（来自 `editor-ui`），`useConfirmationController` 需要 `ConfirmationChoice/State`（来自 `editor-ui`）。但 `editor-core` 不能引入 `editor-ui`（`editor-ui` 已依赖 `editor-core`，会形成环）。

解法：把这三个类型从 `editor-ui` 迁到 `editor-core`，`editor-ui` 再 re-export 保持兼容。

**障碍 B：editor-core 含 Tauri 依赖**

`packages/editor-core/src/recent-files.ts` 中的 `createTauriRecentFilesBackend()` 动态 import 了 `@tauri-apps/api/core`，导致 `editor-core` 目前不是真正平台无关的包。

解法：把 `createTauriRecentFilesBackend` 函数迁到 `apps/desktop`，`editor-core` 只保留接口和内存实现，`@tauri-apps/api` 从 `editor-core` 依赖中移除。

**障碍 C：useMdxAiController 硬依赖 runtime 单例**

```ts
import { runtime } from "../runtime/editor-runtime";
const mdxComponentPlugins = useMemo(() => runtime.mdxComponents.listInsertable(), []);
```

解法：把 `getMdxComponentPlugins` 改为参数注入。

---

## 3. 执行顺序

必须**严格按顺序**执行，每步完成后运行验证命令：

1. 迁移类型：`TocTarget`、`ConfirmationChoice`、`ConfirmationState`
2. 清理 `editor-core` 的 Tauri 依赖（`recent-files.ts`）
3. 更新 `editor-core/package.json`（加 React peer dep，移除 `@tauri-apps/api`）
4. 迁移 `useFileActionController` 和 `controller-errors`
5. 迁移 `useConfirmationController`
6. 迁移 `useOutlineController`
7. 迁移 `useMdxAiController`（需改造）
8. 更新 `editor-core/src/index.ts` 导出
9. 更新桌面端 import 路径
10. 全量验证

---

## 4. 第一步：迁移类型定义

### 4.1 在 editor-ui 中找到类型的当前位置

- `TocTarget`、`EditorScrollTarget`、`SourceEditorView` 定义在 `packages/editor-ui/src/types.ts`
- `ConfirmationChoice`、`ConfirmationState` 定义在 `packages/editor-ui/src/components/ConfirmActionDialog.tsx`
- `editor-ui` 的 `index.ts` 当前导出方式：
  ```ts
  export type { EditorScrollTarget, SourceEditorView, TocTarget } from "./types";
  export { ConfirmationChoice, ConfirmationState, ... } from "./components/ConfirmActionDialog";
  ```

### 4.2 在 editor-core 新建类型文件

新建 `packages/editor-core/src/toc.ts`：

```ts
export interface TocTarget {
  readonly line: number;
  readonly level: number;
  readonly text: string;
  readonly nonce: number;
}
```

新建 `packages/editor-core/src/confirmation.ts`：

```ts
export type ConfirmationChoice = "confirm" | "secondary" | "cancel";

export interface ConfirmationState {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly secondaryLabel?: string;
  readonly destructive?: boolean;
}
```

> **注意**：`ConfirmationState.description` 在 `ConfirmActionDialog.tsx` 中是 `readonly description: string`（必填），但在 `useConfirmationController` 的调用处有些地方不传 `description`。迁移时需确认实际使用，保持一致。检查命令：
> ```bash
> grep -rn "requestConfirmation({" apps/desktop/src --include="*.ts" | grep -v "description:"
> ```

### 4.3 修改 editor-ui 使用 re-export

修改 `packages/editor-ui/src/types.ts`，将 `TocTarget` 定义替换为从 `editor-core` re-export：

```ts
// 迁移后的 types.ts
export type { TocTarget } from "@md-editor/editor-core";  // ← re-export

export interface EditorScrollTarget {
  readonly ratio: number;
  readonly nonce: number;
}

export interface SourceEditorView {
  // ... 保持不变
}
```

修改 `packages/editor-ui/src/components/ConfirmActionDialog.tsx`，将类型定义替换为从 `editor-core` 导入：

```ts
// 迁移前（删除这两行类型定义）：
export type ConfirmationChoice = "confirm" | "secondary" | "cancel";
export interface ConfirmationState { ... }

// 迁移后（改为从 editor-core 导入）：
export type { ConfirmationChoice, ConfirmationState } from "@md-editor/editor-core";
```

`editor-ui/src/index.ts` 的导出行**不需要修改**，因为它已经从 `./components/ConfirmActionDialog` 和 `./types` 导出，这些文件改为 re-export 后路径不变。

### 4.4 验证

```bash
pnpm --filter @md-editor/editor-ui typecheck
pnpm --filter @md-editor/editor-core typecheck
```

---

## 5. 第二步：清理 editor-core 的 Tauri 依赖

### 5.1 在桌面端新建 Tauri recent-files backend

新建 `apps/desktop/src/desktop/recent-files-tauri-backend.ts`：

```ts
import type { RecentFile, RecentFilesBackend } from "@md-editor/editor-core";

export function createTauriRecentFilesBackend(): RecentFilesBackend | null {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return null;
  }

  return {
    async load() {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<RecentFile[]>("load_recent_files");
    },
    async save(files) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_recent_files", { recentFiles: files });
    },
    async updateMenu() {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("update_recent_files_menu");
    }
  };
}
```

### 5.2 修改 editor-core/src/recent-files.ts

从文件末尾删除整个 `createTauriRecentFilesBackend` 函数（约第 150-165 行）。

修改 `createRecentFilesStore` 函数签名，将默认参数从 `createTauriRecentFilesBackend()` 改为 `null`：

```ts
// 迁移前
export function createRecentFilesStore(
  storage: Storage = typeof window !== "undefined" ? window.localStorage : createMemoryStorage(),
  backend: RecentFilesBackend | null = createTauriRecentFilesBackend()
): RecentFilesStore {

// 迁移后
export function createRecentFilesStore(
  storage: Storage = typeof window !== "undefined" ? window.localStorage : createMemoryStorage(),
  backend: RecentFilesBackend | null = null
): RecentFilesStore {
```

### 5.3 修改桌面端的 recent-files-store.ts

`apps/desktop/src/app/controller/recent-files-store.ts` 当前内容：

```ts
import { createRecentFilesStore } from "@md-editor/editor-core";
export const recentFilesStore = createRecentFilesStore();
```

修改为：

```ts
import { createRecentFilesStore } from "@md-editor/editor-core";
import { createTauriRecentFilesBackend } from "../../desktop/recent-files-tauri-backend";

export const recentFilesStore = createRecentFilesStore(undefined, createTauriRecentFilesBackend());
```

### 5.4 验证

```bash
pnpm --filter @md-editor/editor-core typecheck
pnpm --filter @md-editor/desktop typecheck
```

---

## 6. 第三步：更新 editor-core/package.json

```json
{
  "dependencies": {
    "@md-editor/markdown-fidelity": "workspace:*",
    "@md-editor/mdx-component-registry": "workspace:*",
    "@md-editor/shared": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  }
}
```

**变更说明**：
- 移除 `@tauri-apps/api`（第 2 步完成后此依赖不再使用）
- 加 `react` 为 peerDependency（hooks 需要 React，但不应捆绑）
- 加 `@md-editor/markdown-fidelity`（`useOutlineController` 需要）

验证：
```bash
pnpm install
pnpm --filter @md-editor/editor-core typecheck
```

---

## 7. 第四步：迁移 useFileActionController

### 7.1 新建目录并迁移文件

创建目录 `packages/editor-core/src/hooks/`。

新建 `packages/editor-core/src/hooks/controller-errors.ts`，内容与桌面端完全相同：

```ts
export function formatActionError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}
```

新建 `packages/editor-core/src/hooks/useFileActionController.ts`，从桌面端复制并修改 import 路径：

```ts
import { useCallback, useState } from "react";
import { formatActionError } from "./controller-errors";

// 其余内容与桌面端 useFileActionController.ts 完全相同
```

> `useFileActionController` 中没有任何外部包依赖（除了 React 本身），直接复制即可。

### 7.2 删除桌面端原文件

删除：
- `apps/desktop/src/app/controller/controller-errors.ts`
- `apps/desktop/src/app/controller/useFileActionController.ts`

更新桌面端中所有引用这两个文件的 import：

```bash
# 查找所有引用
grep -rn "from.*controller-errors\|from.*useFileActionController" apps/desktop/src --include="*.ts" --include="*.tsx"
```

将找到的 import 路径从 `"./controller-errors"` / `"./useFileActionController"` 改为从 `@md-editor/editor-core` 导入：

```ts
// 旧
import { formatActionError } from "./controller-errors";
import { useFileActionController } from "./useFileActionController";

// 新
import { formatActionError } from "@md-editor/editor-core";
import { useFileActionController } from "@md-editor/editor-core";
```

---

## 8. 第五步：迁移 useConfirmationController

新建 `packages/editor-core/src/hooks/useConfirmationController.ts`，内容从桌面端复制，修改 import：

```ts
import { useCallback, useRef, useState } from "react";
import type { ConfirmationChoice, ConfirmationState } from "../confirmation";
// 其余内容完全相同
```

桌面端删除原文件，更新 import 路径：

```bash
grep -rn "from.*useConfirmationController" apps/desktop/src --include="*.ts" --include="*.tsx"
```

---

## 9. 第六步：迁移 useOutlineController

新建 `packages/editor-core/src/hooks/useOutlineController.ts`，内容从桌面端复制，修改 import：

```ts
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { TocTarget } from "../toc";                                    // ← 从本包引入
import { extractHeadingOutline, findActiveHeadingIdForLine } from "@md-editor/markdown-fidelity";
// 其余内容完全相同
```

桌面端删除原文件，更新 import 路径。

---

## 10. 第七步：迁移 useMdxAiController（需改造）

### 10.1 改造内容

`useMdxAiController` 目前硬依赖桌面端 `runtime` 单例：

```ts
// 需要删除这行 import
import { runtime } from "../runtime/editor-runtime";

// 需要修改这行
const mdxComponentPlugins = useMemo(() => runtime.mdxComponents.listInsertable(), []);
```

**改造方案**：新增参数 `getMdxComponentPlugins`：

```ts
// 迁移后的接口
interface UseMdxAiControllerOptions {
  readonly aiSettings: AiSettings;
  readonly getEditorMode: () => EditorMode;
  readonly getMdxComponentPlugins: () => readonly MdxComponentPlugin[];  // ← 新增
  readonly showToast: (message: string | null) => void;
}
```

并将内部对 `runtime` 的调用替换：

```ts
// 迁移前
const mdxComponentPlugins = useMemo(() => runtime.mdxComponents.listInsertable(), []);

// 迁移后
const mdxComponentPlugins = useMemo(() => getMdxComponentPlugins(), [getMdxComponentPlugins]);
```

### 10.2 新建文件

新建 `packages/editor-core/src/hooks/useMdxAiController.ts`：

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import type { AiCompletionContext, AiSettings, EditorMode } from "../index";
import type { MdxComponentPlugin } from "@md-editor/mdx-component-registry";
import {
  getAiCompletionReadiness,
  requestAiContinuation
} from "../ai/ai-completion";     // ← 注意：ai-completion 也需要从 desktop 迁移到 editor-core（见 10.3）

// ... 其余内容与桌面端相同，但：
// 1. 删除 import { runtime } from "../runtime/editor-runtime"
// 2. 新增参数 getMdxComponentPlugins
// 3. 替换 runtime.mdxComponents.listInsertable()
```

### 10.3 ai-completion 的依赖

`useMdxAiController` 还依赖 `../ai/ai-completion`（在 `apps/desktop/src/app/ai/ai-completion.ts`）。

检查该文件是否有平台依赖：

```bash
grep -n "^import" apps/desktop/src/app/ai/ai-completion.ts
```

如果没有 Tauri 依赖，也需要迁移到 `editor-core`。如果有，需要先剥离平台无关部分。

### 10.4 更新桌面端调用处

`apps/desktop/src/components/DesktopMilkdownEditor.tsx` 需新增 `getMdxComponentPlugins` 参数：

```ts
// 迁移前
useMdxAiController({
  aiSettings: settings.ai,
  getEditorMode,
  showToast,
});

// 迁移后
import { runtime } from "../app/runtime/editor-runtime";

useMdxAiController({
  aiSettings: settings.ai,
  getEditorMode,
  getMdxComponentPlugins: () => runtime.mdxComponents.listInsertable(),  // ← 新增
  showToast,
});
```

---

## 11. 第八步：更新 editor-core/src/index.ts 导出

在 `packages/editor-core/src/index.ts` 末尾追加：

```ts
// 类型
export * from "./toc.ts";
export * from "./confirmation.ts";

// Hooks（可按需按子路径导出，也可统一从主入口导出）
export * from "./hooks/controller-errors.ts";
export * from "./hooks/useFileActionController.ts";
export * from "./hooks/useConfirmationController.ts";
export * from "./hooks/useOutlineController.ts";
export * from "./hooks/useMdxAiController.ts";
```

---

## 12. 完整变更文件清单

### 新增

| 文件 | 说明 |
|------|------|
| `packages/editor-core/src/toc.ts` | TocTarget 类型 |
| `packages/editor-core/src/confirmation.ts` | ConfirmationChoice/State 类型 |
| `packages/editor-core/src/hooks/controller-errors.ts` | 从 desktop 迁入 |
| `packages/editor-core/src/hooks/useFileActionController.ts` | 从 desktop 迁入 |
| `packages/editor-core/src/hooks/useConfirmationController.ts` | 从 desktop 迁入 |
| `packages/editor-core/src/hooks/useOutlineController.ts` | 从 desktop 迁入 |
| `packages/editor-core/src/hooks/useMdxAiController.ts` | 从 desktop 迁入（改造） |
| `apps/desktop/src/desktop/recent-files-tauri-backend.ts` | 从 editor-core 移出 |

### 修改

| 文件 | 变更内容 |
|------|---------|
| `packages/editor-core/package.json` | 加 React peer dep，移除 `@tauri-apps/api`，加 `@md-editor/markdown-fidelity` |
| `packages/editor-core/src/index.ts` | 导出新类型和 hooks |
| `packages/editor-core/src/recent-files.ts` | 删除 `createTauriRecentFilesBackend`，`backend` 默认值改为 `null` |
| `packages/editor-ui/src/types.ts` | `TocTarget` 改为从 `editor-core` re-export |
| `packages/editor-ui/src/components/ConfirmActionDialog.tsx` | `ConfirmationChoice/State` 改为从 `editor-core` 导入 |
| `apps/desktop/src/app/controller/recent-files-store.ts` | 显式传入 Tauri backend |
| `apps/desktop/src/components/DesktopMilkdownEditor.tsx` | 新增 `getMdxComponentPlugins` 参数 |
| `apps/desktop/src/app/controller/useDesktopEditorController.ts` | 更新 import 路径 |

### 删除

| 文件 | 说明 |
|------|------|
| `apps/desktop/src/app/controller/controller-errors.ts` | 已迁到 editor-core |
| `apps/desktop/src/app/controller/useFileActionController.ts` | 已迁到 editor-core |
| `apps/desktop/src/app/controller/useConfirmationController.ts` | 已迁到 editor-core |
| `apps/desktop/src/app/controller/useOutlineController.ts` | 已迁到 editor-core |
| `apps/desktop/src/app/controller/useMdxAiController.ts` | 已迁到 editor-core |

---

## 13. 每步验证命令

```bash
# 单包 typecheck（快速定位问题）
pnpm --filter @md-editor/editor-core typecheck
pnpm --filter @md-editor/editor-ui typecheck
pnpm --filter @md-editor/desktop typecheck

# 全量（最终验收）
pnpm typecheck
pnpm test
```

---

## 14. 注意事项

1. **执行顺序不可颠倒**：必须先迁类型（第 4 步），再迁 hooks（第 7-10 步），否则 editor-core 里的 hooks 找不到类型定义。

2. **每步完成后立即 typecheck**：尽早发现问题，避免多步出错叠加难以定位。

3. **`useMdxAiController` 依赖链最长**：它还依赖 `ai-completion.ts`，需先确认 `ai-completion.ts` 是否有 Tauri 依赖，再决定是否同步迁移。

4. **不要修改 hook 的对外接口**（除 `useMdxAiController` 新增 `getMdxComponentPlugins` 外），桌面端只需改 import 路径，减少回归风险。

5. **`editor-core` 加 React peer dep 后**，`packages/editor-core/tsconfig.json` 中需要能解析 React 类型，检查是否需要加 `@types/react` 到 devDependencies。
