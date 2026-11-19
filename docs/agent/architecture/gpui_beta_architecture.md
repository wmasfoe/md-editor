# GPUI Beta 架构

用途：记录桌面与 Playground 共用 Rust 编辑器的目录、构建入口和 Beta 验收范围。

| 目录 | 职责 |
| --- | --- |
| `packages/editor-core` | Markdown 源文档、原始字节偏移、语法投影和格式操作 |
| `packages/editor-gpui` | GPUI 编辑、选区、可视化区块、表格单元格和大纲 |
| `apps/desktop` | 原生窗口、Finder 打开、文件与图片资源读写、本地模型调用 |
| `packages/editor-web` | GPUI 浏览器后端的 WASM 入口和私有 JavaScript 接口 |
| `apps/web` | Playground 页面、文件导入、剪贴板和下载 |

两个宿主都从 `inkpoint-editor-gpui` 创建编辑视图。Markdown 原文用于保存与导出，区块投影提供编辑位置。桌面宿主负责保存图片，编辑器校验文档版本、选区和输入法状态后插入 Markdown 引用。llama.cpp 由桌面宿主管理，已安装的 GGUF 模型由桌面端按需加载。

## 本地构建

- `pnpm dev:desktop` 启动原生桌面应用。
- `pnpm dev:web` 构建 WASM 并启动 Playground。构建需要 WASM 工具链与 `wasm-bindgen-cli`，版本以 Beta CI 为准。
- `pnpm --filter @md-editor/editor-web test:packed` 在临时目录安装生成的包并检查入口。该包为私有 workspace 依赖。

Beta CI 生成 Apple Silicon DMG 和独立的 Playground ZIP。Playground ZIP 解压后从静态 HTTP 服务打开。

## 当前功能差异

富文本模式按区块或表格单元格进入编辑。编辑强调、链接和数学表达式时会显示该区块的 Markdown 标记。现有的插件运行、完整 MDX 组件、会话恢复和文档历史，以及 AI 纠错和风格学习尚未迁移。浏览器验证覆盖 Chromium 文件导入、中文输入、撤销和下载，平台输入法的组合输入仍需单独验收。
