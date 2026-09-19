# @md-editor/editor-ui

Inkpoint 编辑器的 React UI 视图层组件库。负责提供围绕核心编辑器的界面交互系统，包括编辑器 React 容器包装器、悬浮格式化菜单、斜杠快捷指令面板、文件工作区目录树及实时大纲导航面板。

---

## 1. 架构定位

`@md-editor/editor-ui` 位于渲染引擎与具体应用（Desktop / Web / uTools / Mobile）之间：

- **只做组合与视图呈现**：将 `@md-editor/editor-core` 的状态机和 `@md-editor/renderer-codemirror` 的底层视图包装为标准的 React 19 组件。
- **不承载核心文档计算**：不直接操作 AST 或修改底层文本结构，所有操作通过触发 `editor-core` 的命令或派发 `renderer-codemirror` 的 Transaction 完成。
- **支持主题与国际化**：全面适配深浅色模式（Tailwind CSS）并深度整合 `@md-editor/i18n` 多语言方案。

---

## 2. 核心组件与功能

### 2.1 `CodeMirrorEditor` (`src/components/CodeMirrorEditor/`)
- **React 生命周期绑定**：优雅处理 React 19 StrictMode 下的挂载、卸载与容器尺寸变化（ResizeObserver）。
- **外部状态同步**：文档路径、外部变更、编辑模式切换的平滑响应。
- **事件转发**：对外提供 `onChange`、`onSave`、`onCursorMove` 等干净的 React 属性回调。

### 2.2 `OutlinePanel` (`src/components/OutlinePanel.tsx`)
- **文档大纲树**：实时解析 Markdown 中的 H1 ~ H6 标题层级，构建整洁的可视化导航树。
- **视口动态跟随**：监听编辑器滚动位置，自动高亮当前视野对应的标题节点。
- **平滑定位跳转**：点击大纲项平滑滚动至对应正文位置并定位光标。

### 2.3 `SlashMenu` (斜杠命令面板)
- **极速唤起**：在空白行输入 `/` 即刻弹出快捷指令浮层。
- **组件/块级插入**：支持一键快速插入各类标题、表格、代码块、引用、Mermaid 图表、数学公式及 Callout 提示框。
- **键盘直达**：全键盘导航（方向键选择、Enter 确认、Esc 关闭）。

### 2.4 `FloatingMenu` (选区悬浮工具栏)
- **划词即显**：当用户选中一段文本时，在选区上方自适应定位弹出。
- **富文本快捷操作**：粗体、斜体、删除线、行内代码、超链接包裹等高频操作。

---

## 3. 主要 API 与使用

```tsx
import React, { useRef } from "react";
import { CodeMirrorEditor, OutlinePanel } from "@md-editor/editor-ui";
import { createDocumentState } from "@md-editor/editor-core";

export function EditorPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const doc = createDocumentState({ initialContent: "# Hello World" });

  return (
    <div className="flex h-screen">
      {/* 编辑区主视图 */}
      <div className="flex-1 overflow-hidden" ref={containerRef}>
        <CodeMirrorEditor
          documentState={doc}
          mode="wysiwyg"
          onChange={(content) => console.log(content)}
        />
      </div>

      {/* 右侧大纲面板 */}
      <div className="w-64 border-l border-neutral-200 dark:border-neutral-800">
        <OutlinePanel documentState={doc} />
      </div>
    </div>
  );
}
```

---

## 4. 开发与测试

```bash
# 运行单测
pnpm test

# 执行 TypeScript 校验
pnpm typecheck

# 编译子包
pnpm build
```
