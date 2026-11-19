# GPUI Beta 架构

用途：记录 macOS GPUI 桌面端和 Playground 的编辑器边界、构建入口和 Beta 验收范围。

| 目录 | 职责 |
| --- | --- |
| `packages/editor-core` | Markdown 源文档、原始字节偏移、语法投影和格式操作 |
| `packages/editor-gpui` | Playground 的 GPUI 编辑、选区、可视化区块、表格单元格和大纲 |
| `packages/editor` | macOS 桌面正文使用的 CodeMirror 源码和所见即所得编辑器 |
| `apps/desktop` | GPUI 窗口与侧栏、WKWebView 编辑区、Finder 打开、文件与图片读写、本地模型调用 |
| `packages/editor-web` | GPUI 浏览器后端的 WASM 入口和私有 JavaScript 接口 |
| `apps/web` | Playground 页面、文件导入和下载 |

macOS 桌面正文默认所见即所得，源码模式与它共用同一份 Markdown、选区和撤销历史。桌面宿主在保存或关闭前读取编辑器快照，负责文件和图片写入。插入图片与本地 AI 续写时，由编辑器再次校验文档版本、选区和输入法状态。llama.cpp 由桌面宿主管理，已安装的 GGUF 模型按需加载。浏览器 Playground 通过 `inkpoint-editor-gpui` 编辑原始 Markdown。

## 本地构建

- `pnpm dev:desktop` 先构建编辑区资源，再启动原生桌面应用。可在命令后直接传入 Markdown 路径。
- `pnpm dev:web` 构建 WASM 并启动 Playground。构建需要 WASM 工具链与 `wasm-bindgen-cli`，版本以 Beta CI 为准。
- `pnpm --filter @md-editor/editor-web test:packed` 在临时目录安装生成的包并检查入口。该包为私有 workspace 依赖。

Beta CI 将编辑区资源打包进 Apple Silicon `.app`，并生成 DMG 和独立的 Playground ZIP。Playground ZIP 解压后从静态 HTTP 服务打开。

## Web 端 JS 层边界

JS 只承担两件 WASM 无法自举的事：`wasm-bindgen` 的 `init()`，以及 DOM 宿主
（挂载点、`<input type=file>` 文件选择、`<a download>` 下载）。总计约 110 行。

**剪贴板写在 Rust。** `gpui-pre-web` 的 `Platform::write_to_clipboard` 已封装
`navigator.clipboard.write_text`，与桌面端同一条路径。`packages/editor-web` 导出
`copy_markdown()`，JS 侧只需在 click 的同步栈内调用（浏览器要求用户激活）。

**文件选择与下载保留 DOM，是权衡而非能力缺失：**

- `Platform::prompt_for_paths` / `prompt_for_new_path` 在 web 端明确返回
  `not supported on the web`，没有现成 API 可用。
- `gpui-pre-web` 全仓没有 aria / accesskit 实现。UI 全部画到 canvas 后，屏幕阅读器
  读不到任何控件；现在的 DOM 按钮是唯一无障碍载体。
- Playwright 用 `getByRole` / `#id` 定位控件（见 `apps/web/tests/gpui-playground.spec.ts`）。
  全进 canvas 后只能改坐标点击，e2e 会明显变脆。

彻底 Rust only 只能把 JS 压到约 10 行加载器，代价是无障碍归零与 e2e 重写。
若后续要做，应先确认 `gpui-pre-web` 是否补齐了 a11y，并先为 canvas 场景
建立可定位的 DOM 镜像层。

## 当前功能差异

Playground 的富文本模式按区块或表格单元格进入编辑。桌面端的外部插件运行、会话恢复、文档历史、AI 纠错和风格学习尚未迁移。Playground 的 Chromium 验证覆盖文件导入、中文输入、撤销和下载，macOS 的系统输入法仍需单独验收。
