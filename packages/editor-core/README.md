# @md-editor/editor-core

Inkpoint 编辑器的领域模型核心库，提供与具体渲染引擎（CodeMirror/ProseMirror）和 UI 框架完全解耦的文档状态机、命令调度器与并发保序文件生命周期管理。

---

## 1. 架构定位与职责边界

根据项目的 [架构能力边界设计原则](../../docs/agent/architecture/capability_boundary_design_principles.md)，`@md-editor/editor-core` 是编辑器的“领域模型层（Domain Layer）”：

- **单向依赖**：仅依赖 `@md-editor/shared` 与 `@md-editor/mdx-component-registry`，不依赖任何 DOM、浏览器特定 API 或 CodeMirror 渲染细节。
- **纯粹领域语义**：负责维护文档状态、脏标记、历史栈抽象、统一命令注册与可用性校验、模式切换契约（WYSIWYG ⇄ Source）。
- **杜绝 AI 抽象泄漏**：不直接引入或 re-export `@md-editor/ai`。AI 结果作为领域数据或命令入参注入，不在此层处理网络、模型解析或流式传输。

---

## 2. 核心功能模块

### 2.1 文档状态机 (`DocumentState` & `document-state.ts`)
- **状态流转**：管理当前文档路径（`filePath`）、原始内容（`originalContent`）、实时内容（`content`）、编辑模式（`wysiwyg` 或 `source`）及脏状态（`isDirty`）。
- **并发保序更新**：提供受控的状态更新与事务派发（`dispatch`），防止并发更新产生竞态条件。
- **快照机制**：支持生成轻量级文档快照（`DocumentSnapshot`），用于保存时的一致性校验和撤销/重做对比。

### 2.2 命令调度系统 (`CommandRegistry` & `index.ts`)
- **统一命令注册**：提供 `CommandRegistry`，支持通过 `CommandDescriptor` 声明命令。
- **UI 放置与感知**：支持 `placement` 属性，统一向 `toolbar`（工具栏）、`command-palette`（命令面板）和 `editor-menu`（右键/上下文菜单）分发命令。
- **动态可用性判定**：通过 `when: (context: CommandContext) => boolean` 函数按需启用或隐藏命令。

### 2.3 文件生命周期调度器 (`FileLifecycle` & `file-lifecycle.ts`)
- **防抖与强制保存**：提供带状态感知的并发保存调度，支持自动保存、显式快捷键保存与离开前保存。
- **最近文件列表管理 (`recent-files.ts`)**：支持历史打开文档的 LRU 记录、清理与元数据恢复。

### 2.4 Markdown 结构语义处理
- **呼出块与提示块 (`callout.ts`)**：支持 Obsidian / GFM 风格的 Callout（Note, Tip, Warning 等）语法识别与状态转换。
- **原始片段保护 (`raw-fragments.ts`)**：提供特殊语法块（Frontmatter、公式、HTML 标签）的跨模式保真保护机制。

---

## 3. 主要 API 与导出

```typescript
import {
  DocumentState,
  createDocumentState,
  createCommandRegistry,
  type CommandDescriptor,
  type CommandContext,
  type EditorMode,
} from "@md-editor/editor-core";

// 1. 初始化文档状态
const doc = createDocumentState({
  filePath: "/notes/sample.md",
  initialContent: "# Hello Inkpoint",
  initialMode: "wysiwyg",
});

// 2. 监听状态变化
doc.subscribe((state) => {
  console.log("Dirty status:", state.isDirty);
});

// 3. 注册并执行统一命令
const registry = createCommandRegistry();
registry.register({
  id: "format.bold",
  title: "加粗",
  placement: ["toolbar", "command-palette"],
  run: (ctx) => {
    // 触发加粗动作
  },
});
```

---

## 4. 开发与验证

```bash
# 运行单元测试
pnpm test

# 执行 TypeScript 类型校验
pnpm typecheck

# 单独构建该子包
pnpm build
```
