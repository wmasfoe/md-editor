# Hooks 迁移到 React-facing 层与 editor-core 平台依赖清理手册

用途：指导后续 agent 把桌面端中可复用的 React controller hooks 迁到 React-facing 层，同时保持 `editor-core` 作为平台无关、React 无关的编辑器领域核心。

> 适用性说明：React hooks、平台 adapter 和 AI provider 边界继续有效；Milkdown / SourceEditor 组件命名和双表面组织已被 [`custom_markdown_renderer_architecture.md`](./custom_markdown_renderer_architecture.md) 的 CM6 单编辑器方案替代。

## 1. 目标与边界

目标不是把平台状态塞进 CM6 renderer，也不是把 React hooks 放进 `editor-core`。目标是拆出四层：

| 层 | 职责 | 不应承担 |
| --- | --- | --- |
| `packages/editor-core` | 编辑器领域类型、文档状态契约、命令/快捷键契约、Markdown 纯类型、平台无关算法和 headless store；只保留编辑器命令 ID 等必须理解的 AI 交互入口 | React hooks、DOM、CM6、Tauri、desktop runtime 单例、AI provider/request parsing、agent 编排和 prompt cache |
| `packages/renderer-codemirror` | 单一 CM6 `EditorView`、解析索引、decorations、Widgets、history/selection/IME/scroll 和 AI suggestion 交互状态 | React 页面编排、Tauri、文件系统、AI provider/request parsing |
| `packages/editor-ui` React-facing 层 | React 编辑器容器、React hooks、菜单和外部 UI controller 状态，向 renderer 注入 adapter 与官方 MDX component map | 编辑器源码范围、原子选择、事务、Tauri 文件系统、native menu/window、平台 runtime 直接调用 |
| `apps/desktop` | Tauri/file-system/settings/native menu/window 适配，向 UI/hooks 注入 callback 和数据 | 重复编辑器领域语义、把通用状态硬编码在 desktop wrapper 内 |

第一阶段目标目录：

```text
packages/editor-ui/src/hooks/
packages/editor-ui/src/components/MarkdownEditor.tsx
packages/renderer-codemirror/
```

如果后续 hooks 数量和 API 面继续扩大，再考虑拆出独立包：

```text
packages/editor-react/
```

当前不新增 `editor-react`；`renderer-codemirror` 是 CM6 M0 必需包，不属于可选的 hooks 拆包。

## 2. Renderer 与 React 表面边界

### 2.1 `renderer-codemirror`

renderer 是平台 adapter 无关的 CM6 编辑器实现。它持有唯一 `EditorView`，不维护独立 WYSIWYG / SourceEditor 实例。

职责：

- 持有 Markdown 文本事实源并组合 CM6 extensions、parser adapters、decorations 和 Widgets。
- 实现模式 StateField、源码范围、IME、selection、history、scroll、MDX 原子交互和 AI suggestion 展示语义。
- 消费外部传入的纯数据和 adapter，例如官方 MDX component map、图片 URL resolver、链接打开 callback 和 AI suggestion。
- 在编辑器内部基于当前选区提取必要上下文，并通过 callback 交给外层，例如 `onAiSuggestionRequest(context, request)`。
- 通过 callback 上报编辑结果和 UI 事件，例如 `onChange`、`onOpenLink`、`onScrollRatioChange`。

不负责：

- 文件系统读写、当前文件路径解释、最近文件。
- AI provider 请求、prompt cache、agent 编排、本地模型 invoke。
- native menu/window/settings storage。
- 直接读取 desktop/web/mobile 的 store。
- 管理 React 页面、菜单、toast 或 provider request lifecycle。

### 2.2 外层公开 `MarkdownEditor`

外层组件放在 `editor-ui`，作为各端复用的 React connected layer。对外使用引擎无关的 `MarkdownEditor` 命名，各端通过 adapter/callback 注入平台能力。

职责：

- 组合 document、outline、scroll、confirmation、MDX menu、AI request lifecycle 等平台无关 UI controller 状态。
- 将 adapters、官方 MDX component map 和外部 UI 状态转换为 renderer host 与 `MdxComponentMenu` 等组件 props。
- 接收平台注入的能力，例如 `resolveImageSrc`、`openLink`、`requestAiSuggestion`、`getMdxComponentPlugins` 和 renderer-first external edit port；不得注入绕过 transition 的 snapshot-only `commitMarkdown`。
- 暴露各端可以直接消费的高层 `MarkdownEditor` API。

不负责：

- 直接 import `apps/desktop` store、Tauri API、desktop runtime 单例或 file service。
- 实现 AI provider/prompt/cache/agent。
- 实现文件系统 adapter。

## 3. Desktop wrapper 的最终形态

M0 删除 `DesktopMilkdownEditor.tsx` 和 `DesktopSourceEditor.tsx` 两条产品路径。若 desktop 仍需要 wrapper，只保留单一 `DesktopMarkdownEditor.tsx` adapter。

可以保留的职责：

- lazy import `@md-editor/editor-ui/markdown-editor`
- 从 desktop store/settings 读取数据
- 把 desktop callback 注入通用组件，例如 `resolveImageSrc`、`openWysiwygLink` 和 renderer-first external edit command
- 注册菜单/快捷键需要的命令入口
- 连接 desktop-only 状态，如 document key、asset preview 和平台错误反馈

应该迁出的职责：

- 与平台无关的 confirmation / file action / outline / MDX-AI UI controller 状态
- 可复用的 React hook 状态机
- 与 renderer 可复用交互契约绑定的 glue 逻辑

长期目标是 desktop wrapper 变成很薄的 adapter，或者被删除后改为 desktop 直接渲染 `editor-ui` 的外层 `MarkdownEditor`：

```tsx
<MarkdownEditor adapters={desktopEditorAdapters} />
```

不要把这些状态直接塞进 renderer。renderer 通过纯数据和 adapters 消费外部状态；跨端复用的 React 组合逻辑收敛到外层公开 `MarkdownEditor`。

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
- renderer host 的 React 视图类型
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

- `editor-ui/src/hooks/useMdxAiController.ts` 只管理菜单打开、插入请求和 AI suggestion request lifecycle；展示、接受、取消、失效和选区映射属于 renderer。
- AI provider/request parsing 逻辑不要放进 `editor-ui` 或 `editor-core`。
- provider 请求、prompt 组装、结果解析、本地/远程模型策略统一收敛在 `@md-editor/ai`。
- desktop 只负责把 Tauri `invoke`、settings 和错误提示等平台能力适配后注入 AI 调用链。
- `editor-core` 不提供 `@md-editor/editor-core/ai` 兼容子路径，也不 re-export `@md-editor/ai`。

长期目标：

- 独立 AI 子包 `@md-editor/ai` 承载 provider 请求、prompt 组装、agent 编排、prompt cache、本地/远程模型策略。
- `editor-core` 只保留编辑器命令、Feature descriptor 和非 AI 领域契约；AI 类型从 `@md-editor/ai` 直接导入。
- `editor-ui` 只通过 callback 把 AI suggestion 纯数据注入 renderer，不直接依赖 provider/request/prompt/cache 实现，也不为两种显示模式维护两份 suggestion 状态。

## 8. 执行顺序

1. 先清理 `editor-core` 的 Tauri 依赖，确保 core 回到平台无关。
2. 在 `packages/editor-ui/src/hooks/` 建立 hook 目录。
3. 迁移 `controller-errors` 与 `useFileActionController`。
4. 迁移 `useConfirmationController`。
5. 迁移 `useOutlineController`。
6. 将 provider 请求、prompt 组装和结果解析迁到 `@md-editor/ai`，desktop 通过 adapter 注入本地模型 invoke。
7. 确认 `packages/editor-core/src/index.ts` 不导出 AI request API，`packages/editor-core/package.json` 不暴露 `./ai` 子路径。
8. 改造并迁移 `useMdxAiController`，所有 runtime / provider 调用通过参数注入；hook 内只调用注入的 `requestAiSuggestion`。
9. 新建 `renderer-codemirror`，由它持有单一 `EditorView` 和全部编辑器内交互语义。
10. 在 `editor-ui` 暴露单一 `MarkdownEditor` React 表面和已迁移 hooks，不再导出产品使用的 `MilkdownEditor` / `SourceEditor` 双入口。
11. 更新 desktop import，由 desktop 提供 adapters；直接消费 `MarkdownEditor`，或保留只创建 adapters 的单一薄 wrapper。
12. 删除 desktop 中已迁出的 hook 文件以及旧 `DesktopMilkdownEditor` / `DesktopSourceEditor` 产品路径。

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
- `editor-core` 不包含 `src/ai` provider/request parsing，也不依赖或 re-export `@md-editor/ai`。
- `renderer-codemirror` 独占 CM6 `EditorView`、extensions、源码范围和交互语义，且不依赖 desktop 或 AI provider。
- `editor-ui` 暴露可复用 React hooks 和单一外层 `MarkdownEditor`，不保留产品使用的 Milkdown / SourceEditor 双入口。
- desktop wrapper 没有重复通用 editor/controller 状态，只做平台适配和注入；若已无额外职责，应删除。
- Tauri、file-system、window/menu、local model invoke 等平台行为只存在于 desktop adapter 或通过 callback 注入。
- `pnpm typecheck` 和 `pnpm test` 全量通过，或在最终报告中明确无法运行的原因。
