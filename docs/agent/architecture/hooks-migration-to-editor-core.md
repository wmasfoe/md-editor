# Hooks 迁移到 React-facing 层与 editor-core 平台依赖清理手册

用途：指导后续 agent 把桌面端中可复用的 React controller hooks 迁到 React-facing 层，同时保持 `editor-core` 作为平台无关、React 无关的编辑器领域核心。

## 1. 目标与边界

目标不是把平台状态塞进 `MilkdownEditor` / `SourceEditor` 这类底层组件，也不是把 React hooks 放进 `editor-core`。目标是拆出三层：

| 层 | 职责 | 不应承担 |
| --- | --- | --- |
| `packages/editor-core` | 编辑器领域类型、文档状态契约、命令/快捷键契约、Markdown/AI 纯类型、平台无关算法和 headless store；过渡期临时承载平台无关 AI provider/request parsing | React hooks、DOM、Tauri、desktop runtime 单例、agent 编排和 prompt cache |
| `packages/editor-ui` React-facing 层 | React 组件、React hooks、编辑器 UI controller 状态、两层编辑器组件（底层 primitive + 外层公开 `MilkdownEditor`） | Tauri 文件系统、native menu/window、平台 runtime 直接调用 |
| `apps/desktop` | Tauri/file-system/settings/native menu/window 适配，向 UI/hooks 注入 callback 和数据 | 重复编辑器领域语义、把通用状态硬编码在 desktop wrapper 内 |

第一阶段目标目录：

```text
packages/editor-ui/src/hooks/
packages/editor-ui/src/components/MilkdownEditor.tsx
```

如果后续 hooks 数量和 API 面继续扩大，再考虑拆出独立包：

```text
packages/editor-react/
```

当前不新增包，避免迁移面过大。

## 2. 两层组件边界

### 2.1 底层增强编辑器

底层组件是平台无关的 Milkdown/CodeMirror 编辑器表面。因为外层公开组件应命名为 `MilkdownEditor`，底层 Milkdown 实现命名为内部 primitive：`MilkdownEditorPrimitive`。

职责：

- 渲染传入的 Markdown / document snapshot。
- 组合 Milkdown plugins、Markdown/MDX preview rewrite、代码块工具、IME guard、selection policy、AI suggestion 展示等编辑体验能力。
- 消费外部传入的 request/suggestion props，例如 MDX 插入请求、AI suggestion request、AI pending 状态。
- 在编辑器内部基于当前选区提取必要上下文，并通过 callback 交给外层，例如 `onAiSuggestionRequest(context, request)`。
- 通过 callback 上报编辑结果和 UI 事件，例如 `onChange`、`onOpenLink`、`onScrollRatioChange`。

不负责：

- 文件系统读写、当前文件路径解释、最近文件。
- AI provider 请求、prompt cache、agent 编排、本地模型 invoke。
- native menu/window/settings storage。
- 直接读取 desktop/web/mobile 的 store。

### 2.2 外层公开 `MilkdownEditor`

外层组件放在 `editor-ui`，作为各端复用的 connected layer。对外仍叫 `MilkdownEditor`，因为调用方消费的是完整的 Markdown/Milkdown 编辑体验，而不是内部 primitive。各端通过 adapter/callback 注入平台能力，避免每个端都手动拼底层组件的大量 props。

职责：

- 组合 document、outline、scroll、confirmation、MDX menu、AI request lifecycle 等平台无关 UI controller 状态。
- 将 adapters 转换为底层 `MilkdownEditor` / `SourceEditor` / `MdxComponentMenu` 等组件 props。
- 接收平台注入的能力，例如 `resolveImageSrc`、`openLink`、`requestAiSuggestion`、`getMdxComponentPlugins`、`commitMarkdown`。
- 暴露各端可以直接消费的高层 `MilkdownEditor` API。

不负责：

- 直接 import `apps/desktop` store、Tauri API、desktop runtime 单例或 file service。
- 实现 AI provider/prompt/cache/agent。
- 实现文件系统 adapter。

## 3. Desktop wrapper 的最终形态

`apps/desktop/src/components/DesktopMilkdownEditor.tsx`、`DesktopSourceEditor.tsx` 这类组件不需要因为“原始组件在 editor-ui 中”而强制删除。

可以保留的职责：

- lazy import `@md-editor/editor-ui/milkdown-editor` / `source-editor`
- 从 desktop store/settings 读取数据
- 把 desktop callback 注入通用组件，例如 `resolveImageSrc`、`openWysiwygLink`、`commitMarkdown`
- 注册菜单/快捷键需要的命令入口
- 连接 desktop-only 状态，如 document key、mode scroll target、asset preview

应该迁出的职责：

- 与平台无关的 confirmation / file action / outline / MDX-AI UI controller 状态
- 可复用的 React hook 状态机
- 与 `MilkdownEditor` / `SourceEditor` 可复用交互契约绑定的 glue 逻辑

长期目标是 desktop wrapper 变成很薄的 adapter，或者被删除后改为 desktop 直接渲染 `editor-ui` 的外层 `MilkdownEditor`：

```tsx
<MilkdownEditor adapters={desktopEditorAdapters} />
```

不要把这些状态直接塞进底层 primitive。底层 primitive 应继续保持受控组件形态，通过 props/callbacks 消费外部状态；跨端复用的组合逻辑收敛到外层公开 `MilkdownEditor`。

## 4. 需要迁移的 hooks

| 源文件（desktop） | 目标（React-facing 层） | 说明 |
| --- | --- | --- |
| `apps/desktop/src/app/controller/useFileActionController.ts` | `packages/editor-ui/src/hooks/useFileActionController.ts` | 通用 pending action + toast glue |
| `apps/desktop/src/app/controller/controller-errors.ts` | `packages/editor-ui/src/hooks/controller-errors.ts` | hook 辅助函数 |
| `apps/desktop/src/app/controller/useConfirmationController.ts` | `packages/editor-ui/src/hooks/useConfirmationController.ts` | 与 `ConfirmActionDialog` 类型同属 UI 层 |
| `apps/desktop/src/app/controller/useOutlineController.ts` | `packages/editor-ui/src/hooks/useOutlineController.ts` | 与 TOC / editor visible line UI 交互同属 UI 层 |
| `apps/desktop/src/app/controller/useMdxAiController.ts` | `packages/editor-ui/src/hooks/useMdxAiController.ts` | 需要 callback 注入，不能依赖 desktop runtime 单例 |

保留在 desktop：

- `useFileTreeController.ts`：依赖 Tauri 文件系统和 `fileService`
- `useDocumentActionsController.ts`：依赖 desktop document/file operations
- `useDesktopEditorController.ts`：desktop 协调层，负责平台事件、store 同步、native menu/window
- `useSettingsController.ts`：desktop 设置 API

## 5. 类型迁移策略

因为 hooks 迁到 `editor-ui`，不再需要为了避免 `editor-core -> editor-ui` 循环而把以下类型迁入 `editor-core`：

- `TocTarget`
- `EditorScrollTarget`
- `SourceEditorView`
- `ConfirmationChoice`
- `ConfirmationState`

这些类型当前可以继续留在 `editor-ui`。如果未来发现某个类型确实是跨 UI / non-UI 的领域契约，再单独迁到 `editor-core`。

## 6. 清理 editor-core 的 Tauri 依赖

`editor-core` 必须保持平台无关。`packages/editor-core/src/recent-files.ts` 当前不应包含 Tauri backend，也不应让 `@md-editor/editor-core` 依赖 `@tauri-apps/api`。

### 6.1 editor-core 只保留接口和默认无平台实现

`createRecentFilesStore` 的默认 backend 应为 `null`：

```ts
export function createRecentFilesStore(
  storage: Storage = typeof window !== "undefined" ? window.localStorage : createMemoryStorage(),
  backend: RecentFilesBackend | null = null
): RecentFilesStore {
  // ...
}
```

从 `packages/editor-core/src/recent-files.ts` 删除 `createTauriRecentFilesBackend`。

从 `packages/editor-core/package.json` 删除：

```json
"@tauri-apps/api": "catalog:"
```

### 6.2 desktop 提供 Tauri backend

新增 `apps/desktop/src/desktop/recent-files-tauri-backend.ts`：

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

更新 `apps/desktop/src/app/controller/recent-files-store.ts`：

```ts
import { createRecentFilesStore } from "@md-editor/editor-core";
import { createTauriRecentFilesBackend } from "../../desktop/recent-files-tauri-backend";

export const recentFilesStore = createRecentFilesStore(undefined, createTauriRecentFilesBackend());
```

## 7. useMdxAiController 的特殊边界

`useMdxAiController` 不能直接导入 desktop runtime：

```ts
import { runtime } from "../runtime/editor-runtime";
```

迁移后通过参数注入：

```ts
interface UseMdxAiControllerOptions {
  readonly aiSettings: AiSettings;
  readonly getEditorMode: () => EditorMode;
  readonly getMdxComponentPlugins: () => readonly MdxComponentPlugin[];
  readonly requestAiSuggestion: (
    context: AiCompletionContext,
    request?: { readonly signal?: AbortSignal }
  ) => Promise<AiWritingSuggestion>;
  readonly showToast: (message: string | null) => void;
}
```

建议职责拆分：

- `editor-ui/src/hooks/useMdxAiController.ts` 只管理菜单打开、插入请求、AI suggestion request lifecycle。
- AI provider/request parsing 逻辑不要放进 `editor-ui`。
- 过渡期将 `apps/desktop/src/app/ai/ai-completion.ts` 下沉到 `packages/editor-core/src/ai/ai-completion.ts`，作为临时 headless 位置。
- 下沉前必须剥离 Tauri 默认路径：本地模型调用通过 `localInvokeImpl` 注入，不能在 `editor-core` 动态 import `@tauri-apps/api/core`。
- 在 `packages/editor-core/src/ai/` 文件顶部保留简短注释：该目录是 AI 子包拆分前的临时位置，未来迁往独立 AI 包。

长期目标：

- 新建独立 AI 子包（暂定 `@md-editor/ai`）承载 provider 请求、prompt 组装、agent 编排、prompt cache、本地/远程模型策略。
- `editor-core` 最终只保留编辑器需要理解的 AI 纯类型和契约。
- `editor-ui` 只通过 callback 消费 AI suggestion，不直接依赖 provider/request/prompt/cache 实现。

## 8. 执行顺序

1. 先清理 `editor-core` 的 Tauri 依赖，确保 core 回到平台无关。
2. 在 `packages/editor-ui/src/hooks/` 建立 hook 目录。
3. 迁移 `controller-errors` 与 `useFileActionController`。
4. 迁移 `useConfirmationController`。
5. 迁移 `useOutlineController`。
6. 将 `apps/desktop/src/app/ai/ai-completion.ts` 迁到 `packages/editor-core/src/ai/ai-completion.ts`，删除其中的 Tauri 动态 import fallback，改为要求 desktop 注入 `localInvokeImpl`。
7. 从 `packages/editor-core/src/index.ts` 导出临时 AI request API，并在导出附近注明未来迁往 AI 子包。
8. 改造并迁移 `useMdxAiController`，所有 runtime / provider 调用通过参数注入；hook 内只调用注入的 `requestAiSuggestion`。
9. 重构 `packages/editor-ui/src/components/MilkdownEditor.tsx`：外层公开组件保留/命名为 `MilkdownEditor`，内部 Milkdown 实现改名为 `MilkdownEditorPrimitive`，并由外层消费迁出的 hooks 后渲染。
10. 从 `packages/editor-ui/src/index.ts` 导出新 hooks 和外层编辑器类型；`MilkdownEditor` / `SourceEditor` 组件 value 继续只通过 `./milkdown-editor` / `./source-editor` 子路径导出，避免轻量 root import 拉入 heavy editor 模块。
11. 更新 desktop import，desktop 负责提供 adapters；优先让 desktop 直接消费外层 `MilkdownEditor`，或把原 wrapper 压缩为只创建 adapters 的薄层。
12. 删除 desktop 中已迁出的 hook 文件；如果 wrapper 已无额外职责，则删除 wrapper 组件。

## 9. 验证命令

每步至少跑相关包：

```bash
pnpm --filter @md-editor/editor-core typecheck
pnpm --filter @md-editor/editor-ui typecheck
pnpm --filter @md-editor/desktop typecheck
```

最终验收：

```bash
pnpm typecheck
pnpm test
```

## 10. 验收标准

- `editor-core` 不依赖 `@tauri-apps/api`。
- `editor-core` 不新增 React 依赖。
- `editor-core/src/ai` 只包含平台无关的临时 AI provider/request parsing，不包含 Tauri import、agent 编排或 prompt cache。
- `editor-ui` 暴露可复用 React hooks 和外层公开 `MilkdownEditor`；底层 primitive 仍保持 controlled props/callbacks。
- desktop wrapper 没有重复通用 editor/controller 状态，只做平台适配和注入；若已无额外职责，应删除。
- Tauri、file-system、window/menu、local model invoke 等平台行为只存在于 desktop adapter 或通过 callback 注入。
- `pnpm typecheck` 和 `pnpm test` 全量通过，或在最终报告中明确无法运行的原因。
