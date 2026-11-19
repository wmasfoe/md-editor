# GPUI 桌面编辑区架构

用途：记录桌面端与 Playground 的编辑器边界、构建入口，以及「为什么桌面正文是纯 Rust 而不是 WebView」这个决定的完整理由。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `packages/editor-core` | Markdown 源文档、UTF-8 字节偏移、语法投影和格式操作原语 |
| `packages/editor-typeset` | 排版与编辑引擎：文档解析、光标与选区、编辑操作、垂直移动、SVG 通道、mermaid 与数学公式渲染 |
| `packages/editor-gpui` | GPUI 视图层：`TypesetView`（桌面）与 `EditorView`（Playground） |
| `packages/editor-web` | 浏览器 WASM 入口 |
| `apps/desktop` | GPUI 窗口与侧栏、文件与图片读写、本地模型调用 |
| `apps/web` | Playground 页面、文件导入和下载 |

`packages/editor`（CodeMirror 6）仍服务于 Web 应用，桌面端不再使用它。

## 分层与依赖方向

```
editor-core      文档模型（无 DOM、无 GPUI）
     ↓
editor-typeset   排版 + 编辑引擎
     ↓
editor-gpui      GPUI 视图
     ↓
apps/desktop     GPUI 宿主（TypesetView）
apps/web         Playground（EditorView，尚未迁移）
```

排版渲染由上游 `gpui-base` 承担，编辑层由 `editor-typeset` 承担。这条分界的依据见下方 ADR。

**尚未完成：** Playground 仍使用 `packages/editor-gpui/src/view.rs` 的 `EditorView`，那是「块卡片 + 点击弹纯文本编辑框」的旧实现。桌面已切到 `TypesetView`，两个视图并存于 `editor-gpui` 内。把 Playground 也切过去是后续工作，不在本次范围内。

## 本地构建

- `pnpm dev:desktop` 直接启动原生桌面应用，可在命令后传入 Markdown 路径。桌面端不再有独立的编辑器资源构建步骤。
- `pnpm dev:web` 构建 WASM 并启动 Playground。构建需要 WASM 工具链与 `wasm-bindgen-cli`，版本以 Beta CI 为准。
- `pnpm --filter @md-editor/editor-web test:packed` 在临时目录安装生成的包并检查入口。该包为私有 workspace 依赖。

Beta CI 生成 Apple Silicon DMG 与独立的 Playground ZIP。Playground ZIP 解压后从静态 HTTP 服务打开。

## 排版与编辑的分工

`gpui-base` 的 `editor_host` 模块就是为「外部编辑器 + gpui 渲染」设计的。它的契约原文：

> An editor that lives outside gpui-kit keeps its own document model and hands gpui-kit a `BlockNode` tree, the same tree `TextView` renders. gpui-kit renders it and gives back, per text leaf, the geometry the editor needs for hit-testing, caret placement and platform input (IME) bounds.
>
> The host owns editing semantics, document revisions, accessibility and native input integration.

因此职责是：

| 能力 | 归属 |
| --- | --- |
| Markdown → 块树 | `gpui-base::editor_host::parse_markdown` |
| 标题字号层级、行内样式、表格、代码块、图片排版 | `gpui-base` 渲染器（`TextViewStyle`） |
| 文本叶几何（位置、行高、命中、光标） | `gpui-base::editor_host::collect_leaf_geometry` |
| 选区状态、编辑操作、撤销、文档版本 | `editor-typeset` |
| 垂直光标导航 | `editor-typeset`（上游明确不提供） |
| UTF-16 / UTF-8 偏移转换、IME 接线 | `editor-gpui`（`EntityInputHandler`） |

### 两个必须记住的实现约束

**leaf key 必须下达到真正承载文本的那一层。** 标题的文本在内嵌的 `Paragraph` 里，把 key 只挂在 `BlockNode::Heading` 外层会导致该标题完全不上报几何。

**几何收集作用域是隔离的。** 宿主若在自己的 `prepaint` 里收集几何，必须调用 `TypesetDocument::render_blocks` 而不是 `render`；后者自带一层收集作用域，嵌套后外层什么都拿不到。

## 当前功能差异

桌面端已能编辑 Markdown、渲染标题层级、表格单元格编辑与中文输入。Playground 仍使用旧的 `EditorView`（块卡片式），尚未迁移到 `TypesetView`。

尚未迁移到桌面端的能力：外部插件运行、会话恢复、文档历史、AI 纠错与风格学习、PDF/HTML 导出、Quick Look、Sentry。

mermaid 与数学公式在渲染失败时降级为源码展示，不阻塞编辑。桌面端系统输入法的组合输入仍需实机验收。
