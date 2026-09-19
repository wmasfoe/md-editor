# @md-editor/renderer-codemirror

Inkpoint 编辑器的渲染引擎实现层，基于 [CodeMirror 6](https://codemirror.net/) 深度定制。实现**单 `EditorView` 同构架构**，在同一个编辑器实例内提供高性能的 Typora-like 所见即所得（WYSIWYG）与纯源码编辑体验。

---

## 1. 核心架构：单实例同构 (Single-Instance Isomorphism)

传统的 Markdown 所见即所得方案常使用两个独立编辑器（如 ProseMirror 与 CodeMirror）相互转换，存在严重的 AST 转换失真、光标跳变、模式切换性能损耗及撤销历史断裂的问题。

`@md-editor/renderer-codemirror` 采用创新的单实例投影层设计：
- **同构实例**：所见即所得模式与源码模式共享唯一的 CodeMirror 6 `EditorView` 实例；
- **零开销切换**：切换模式仅通过动态装卸 CM6 Compartment 扩展集实现，耗时 < 5ms，无任何 DOM 重新挂载；
- **历史完整性**：撤销/重做栈（History State）与光标选区在模式切换间 100% 保持；
- **纯文本真实**：底层文档始终保持原始纯文本 Markdown，绝不在内存中篡改用户源文本。

---

## 2. 核心模块与功能

### 2.1 所见即所得投影装饰系统 (`src/wysiwyg/`)
- **标记隐去机制**：通过 `Decoration.replace` 在光标离开当前行时隐去 Markdown 标记字符（如 `## `、`**`、`>`、`* ` 等），光标进入或选区跨越时无缝展开源码标记。
- **块级投影组件 (Block Widgets)**：
  - **标题 (Headings)**：动态样式排版与行首折叠指示手柄（Fold Toggle）。
  - **表格 (Tables)**：表格视图实时投影，支持可视化的单元格就地编辑、行列动态增删。
  - **引用块与提示卡 (Blockquotes & Callouts)**：GFM / Obsidian 风格提示块装饰与边框高亮。
  - **列表与任务清单 (Lists & Task Lists)**：多级缩进、原生交互式复选框（点击直接触发底层文本 `[ ]` ⇄ `[x]` 转换）。
  - **代码块 (Code Fences)**：语法高亮预览、代码语言标识与复制按钮部件。
  - **水平分割线 (Horizontal Rules)**：视觉分割线投影替换。

### 2.2 行内富文本投影
- 粗体（Bold）、斜体（Italic）、行内代码（Inline Code）、删除线（Strikethrough）、超链接（Link）的就地美化与点击交互。

### 2.3 交互增强手柄
- **块级悬浮手柄 (Block Drag Handles)**：段落左侧拖拽移动手柄，支持拖拽重排文档块。
- **折叠手柄 (Fold Toggles)**：标题层级折叠、代码块折叠。

### 2.4 AI 写作建议投影层 (Suggestion Preview)
- 遵循架构边界原则，消费 `@md-editor/ai` 产出的纯领域建议数据；
- 负责行内幽灵文本（Ghost Text）渲染、跨行补全预览、Tab 键接受、Esc 取消及光标移动失效控制。

---

## 3. 主要 API 与使用

```typescript
import {
  createMarkdownEditor,
  setEditorMode,
  type MarkdownEditorInstance,
} from "@md-editor/renderer-codemirror";

// 创建编辑器实例挂载至 DOM 容器
const editor: MarkdownEditorInstance = createMarkdownEditor({
  parent: document.getElementById("editor-container")!,
  initialDoc: "# 欢迎使用 Inkpoint",
  mode: "wysiwyg",
  onChange: (newDoc) => {
    console.log("文档更新:", newDoc);
  },
});

// 无缝切换至源码模式
setEditorMode(editor.view, "source");
```

---

## 4. 目录结构

```
packages/renderer-codemirror/
├── src/
│   ├── index.ts           # 统一对外入口
│   ├── renderer.ts        # 编辑器创建与 Compartment 配置管理
│   ├── mode.ts            # 编辑模式定义与状态切换协议
│   ├── diagnostics.ts     # 语法诊断与 Lint 适配器
│   ├── testing.ts         # 单测专用渲染与模拟辅助
│   ├── markdown/          # Markdown 基础语法扩展与 Keymap
│   └── wysiwyg/           # 所见即所得装饰器、替换部件与交互手柄
└── tests/                 # 渲染、模式切换与边界测试用例
```

---

## 5. 开发与测试

```bash
# 运行单测套件
pnpm test

# 执行类型检查
pnpm typecheck

# 检查代码格式与 Lint
pnpm lint
```
