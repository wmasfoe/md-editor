# macOS Quick Look Preview Extension 架构与规范

用途：记录 macOS 系统级 Quick Look (快速查看 / 空格预览) App Extension 的系统接入边界、基于 JavaScriptCore 的离线渲染沙盒架构、与 `@md-editor/renderer-codemirror/static` 共享静态渲染能力的复用设计以及构建流水线规范。

---

## 1. 架构定位与职责边界

Quick Look 扩展属于 **macOS 操作系统平台接入层**（Platform Integration），严格遵从项目架构边界原则：
1. **职责单一性**：仅负责响应系统 `quicklookd` 进程的预览请求，通过沙盒离线管道将 Markdown 文本渲染为高保真、只读的静态 HTML。
2. **零运行时依赖**：不唤起 Inkpoint 编辑器主进程，不引入重型 Webview 或 Node.js 运行时，保证内存开销极小且 <30ms 秒级弹出。
3. **沙盒安全性**：扩展运行在受限的系统沙盒中，100% 离线自包含，不发起任何外部网络请求，不执行任何未知/不受信任的客户端脚本。
4. **渲染能力收敛**：渲染规则不硬编码在 Swift 扩展中，而是复用 `@md-editor/renderer-codemirror/static` 导出的静态渲染流水线，与主 App 共享同一套 Markdown 语法与排版事实源。

---

## 2. 跨层复用架构

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/renderer-codemirror/ (统一渲染层)                       │
├────────────────────────────────┬────────────────────────────────┤
│ 交互式编辑器 (Interactive CM6) │ 静态渲染流水线 (Static Headless)│
│ - ./src/renderer.ts            │ - ./src/static/index.ts        │
│ - 双向光标、Undo栈、Transaction │ - 纯函数: renderStaticHtml     │
│                                │ - 纯函数: renderStaticDocument │
├────────────────────────────────┴────────────────────────────────┤
│ 公共基础设施（直接复用）：                                       │
│ - language-names.ts (代码高亮语言与别名)                         │
│ - callout-data.ts (Callout 提示框图标与默认标题)                 │
│ - html-sanitize.ts (HTML 安全白名单过滤)                         │
│ - frontmatter-yaml.ts (YAML Frontmatter 解析)                   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                   (构建时 Vite lib iife 打包为自包含单文件)
                                 │
                                 ▼
       apps/desktop/src-tauri/extensions/quicklook/
       ├── Resources/
       │   └── quicklook-engine.js     <-- 由 ./static 编译输出的轻量无依赖 JS 引擎
       └── PreviewProvider.swift       <-- 纯原生接入：
                                           读取文件 -> engine.renderDocument() -> 写入 temp preview.html -> QLPreviewReply
```

### 复用收益与应用场景
`@md-editor/renderer-codemirror/static` 是所有**非交互式 Markdown 消费场景**的基石：
- **macOS Quick Look 快速预览**：直接以静态 HTML 响应 Finder 空格预览；
- **导出为 HTML**：保存为带完整样式的自包含 `.html` 文件；
- **导出为 PDF / 图片**：送入无头打印或离线 Canvas 绘制；
- **复制为富文本**：渲染为可粘贴至外部富文本编辑器的语义 HTML。

---

## 3. 系统接入架构

```
Inkpoint.app/
└── Contents/
    ├── MacOS/Inkpoint
    ├── Info.plist (声明 CFBundleDocumentTypes / UTExportedTypeDeclarations)
    └── PlugIns/
        └── InkpointQuickLook.appex/
            ├── Contents/
            │   ├── Info.plist (com.apple.quicklook.preview, QLIsDataBasedPreview: true)
            │   ├── MacOS/InkpointQuickLook (Swift 原生 arm64 二进制)
            │   └── Resources/
            │       └── quicklook-engine.js (由 renderer-codemirror/static 打包的纯 JS 引擎)
```

### 扩展通信与安全执行模型
- 遵守 macOS 12+ `QLPreviewProvider` 与 `QLPreviewingController` 协议；
- **为什么在 Swift 内部采用 JavaScriptCore 预渲染？**
  macOS Finder 的 `QuickLookUIService` 为防止沙盒逃逸和 XSS，在预览浮窗中严格限制 WebContent 动态脚本执行。如果在 HTML 内部使用 `<script>` 动态解析 Markdown，会导致黑屏。
  因此，扩展在 Swift 原生进程内部拉起系统内置的 `JavaScriptCore` 解释器，在后台几毫秒内调用 `InkpointStaticRenderer.renderStaticDocument(...)` 将 Markdown 转为自带内联样式（Light/Dark Theme、Highlight.js 语法着色、Callout 矢量图）的完整静态 HTML 字符串，并直接以文件形式传递给 `QLPreviewReply(fileURL:)` 渲染静态 DOM，完全避开 WebKit 前台脚本沙箱限制。

---

## 4. 渲染能力与降级策略

与 Inkpoint 主应用保持能力一致：
1. **标准 GFM**：标题、段落、粗体、斜体、删除线、引用块、列表、任务复选框、表格、分割线；
2. **代码块语法高亮**：复用 `language-names.ts` 与 `highlight.js`，支持主流编程语言；
3. **GitHub Callouts 提示块**：复用 `callout-data.ts`，原生渲染 Note/Tip/Important/Warning/Caution 提示容器与矢量 SVG；
4. **外观自适应**：利用 `@media (prefers-color-scheme: dark)` 完美匹配 macOS 系统的 Light / Dark Appearance；
5. **MDX 与未知组件**：严禁执行交互代码，统一降级为格式化代码块，杜绝安全隐患；
6. **超大文件保护**：单文件超过 2MB 时自动截断并呈现友好提示，防止快速查看因内存溢出被系统击杀。

---

## 5. 构建流水线与打包规范

1. **引擎打包脚本**：`apps/desktop/scripts/build-quicklook-engine.mjs`
   - 使用 Vite programmatic build (iife 格式) 将 `packages/renderer-codemirror/src/static/index.ts` 打包为纯纯独立的 `quicklook-engine.js`，无任何 DOM 或浏览器全局对象依赖；
   - 包含 marked 解析、highlight.js 代码着色和内联主题 CSS。
2. **扩展编译脚本**：`apps/desktop/scripts/build-quicklook.sh`
   - 先执行 `build-quicklook-engine.mjs` 确保引擎最新；
   - 使用系统内置 `swiftc` 针对 `arm64-apple-macos12.0` 编译；
   - 链接 `QuickLookUI`, `UniformTypeIdentifiers`, `Foundation`, `JavaScriptCore`；
   - 组装 `.appex` 目录并执行 `codesign --sign -` ad-hoc 签名。
3. **Tauri 集成**：
   - `tauri.conf.json` 配置 `bundle.fileAssociations` 声明 `.md`, `.markdown`, `.mdown`, `.mkd` 文件关联；
   - `tauri.macos.conf.json` 配置 `bundle.macOS.files` 将 `InkpointQuickLook.appex` 自动映射注入至 `Contents/PlugIns/`。

