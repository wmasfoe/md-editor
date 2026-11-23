# macOS Quick Look Preview Extension 架构与规范

用途：记录 macOS 系统级 Quick Look（空格预览）App Extension 的系统接入边界、**基于 Rust 静态库的原生渲染架构**、构建流水线与降级策略。

> **迁移说明**：本扩展曾内嵌 1.3 MB 的 `quicklook-engine.js` 并用 JavaScriptCore 执行。
> 渲染核心已迁到 Rust（`crates/render-ffi`），与桌面导出共用同一套实现，
> 由 `scripts/render-diff` 的差分测试守护等价性。旧 JS 引擎已彻底删除。

---

## 1. 架构定位与职责边界

Quick Look 扩展属于 **macOS 操作系统平台接入层**（Platform Integration）：

1. **职责单一性**：仅响应系统 `quicklookd` 进程的预览请求，把 Markdown 渲染为只读静态 HTML。
2. **零运行时依赖**：不唤起 Inkpoint 主进程，不引入 Webview 或 Node.js 运行时。
3. **沙盒安全性**：运行在受限系统沙盒中，100% 离线自包含，不发起网络请求，不执行不受信任的客户端脚本。
4. **渲染能力收敛**：渲染规则不硬编码在 Swift 中，而是复用 `crates/render`（与桌面端同一份 Rust 实现）。

---

## 2. 为什么是 Rust 静态库，而不是 JavaScriptCore

这是本扩展最关键的技术约束。

### 2.1 约束来源

扩展的 entitlements（`extensions/quicklook/entitlements.plist`）只有：

```xml
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.files.user-selected.read-only</key><true/>
```

**没有** `com.apple.security.cs.allow-jit`。这意味着：

| 方案 | 可行性 | 原因 |
|---|---|---|
| HTML 内 `<script>` 动态解析 | ❌ | Finder 预览浮窗严格限制 WebContent 脚本执行，会黑屏 |
| WebAssembly（Rust → wasm） | ❌ | JSC 的 WASM 依赖 JIT，无 entitlement 基本不可用 |
| JavaScriptCore 跑打包 JS | ⚠️ 可用但已废弃 | 需随包 1.3 MB JS，且与桌面端形成第二套渲染实现 |
| **Rust 原生机器码 + C ABI** | ✅ **当前方案** | 原生代码不需要 JIT；内部 QuickJS 是纯解释器，同样不需要 JIT |

### 2.2 关键点：QuickJS 不需要 JIT

Rust 侧用 QuickJS 执行数学（KaTeX）与代码高亮（highlight.js）——这两块必须与 JS 侧字节级一致（原因见 [compiler_architecture.md](./compiler_architecture.md) §3.1）。

**QuickJS 是解释器，不是 JIT**，因此在无 `allow-jit` 的沙盒里正常工作。

---

## 3. 跨层复用架构

```
┌──────────────────────────────────────────────────────────────┐
│ crates/render（Rust 渲染核心，与桌面端共用）                  │
├──────────────────────────────────────────────────────────────┤
│ comrak 解析 → 自研 emitter → HTML                            │
│ 内嵌 QuickJS：katex.min.js（数学）+ highlight.js（代码高亮）  │
│ 构建期从 node_modules 与 packages/compiler/templates 提取资产 │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ crates/render-ffi（C ABI 封装，唯一消费者是本扩展）           │
├──────────────────────────────────────────────────────────────┤
│ md_render_document(markdown, title, customCSS) -> *mut c_char │
│ md_render_fragment(markdown)                    -> *mut c_char │
│ md_render_free_string(pointer)                                │
│ md_render_katex_version()                       -> *const c_char│
└──────────────────────────┬───────────────────────────────────┘
                           │ swiftc -lmd_render_ffi（静态链接）
                           ▼
   apps/desktop/src-tauri/extensions/quicklook/
   └── PreviewProvider.swift   ← 纯原生接入：
                                   读取文件 → RustRenderer.renderDocument()
                                   → 写 temp preview.html → QLPreviewReply
```

### 内存约定

所有返回 `*mut c_char` 的函数，调用方**必须**用 `md_render_free_string` 释放；返回 `NULL` 表示失败，此时 Swift 侧回退为纯文本预览（保证 Finder 里始终有内容，而不是空白）。

---

## 4. 系统接入架构

```
Inkpoint.app/
└── Contents/
    ├── MacOS/Inkpoint
    ├── Info.plist (声明 CFBundleDocumentTypes / UTExportedTypeDeclarations)
    └── PlugIns/
        └── InkpointQuickLook.appex/
            ├── Contents/
            │   ├── Info.plist (com.apple.quicklook.preview, QLIsDataBasedPreview: true)
            │   ├── MacOS/InkpointQuickLook   ← Swift 二进制，静态链接 Rust 渲染核心
            │   └── Resources/                ← 空（不再需要 JS 引擎资产）
```

### 执行模型

1. 遵守 macOS 12+ `QLPreviewProvider` 与 `QLPreviewingController` 协议；
2. 读取 Markdown 文件（超过 2 MB 截断并追加提示）；
3. 调用 `md_render_document(...)` 得到自包含 HTML 字符串；
4. 写入临时目录的 `preview.html`；
5. 用 `QLPreviewReply(fileURL:)` 交付——系统渲染静态 DOM，完全避开 WebKit 前台脚本沙箱。

---

## 5. 渲染能力与降级策略

与 Inkpoint 主应用保持一致（同一份 Rust 实现）：

1. **标准 GFM**：标题、段落、粗体、斜体、删除线、引用块、列表、任务复选框、表格、分割线；
2. **代码块语法高亮**：内嵌 highlight.js，支持 190+ 语言；
3. **GFM Alert 与 `:::容器`**：Note/Tip/Important/Warning/Caution，内联矢量 SVG 图标；
4. **数学公式**：内嵌 KaTeX（版本由构建期锁定，与 JS 侧一致）；
5. **`==highlight==`**：Typora/Obsidian 事实标准；
6. **外观自适应**：`@media (prefers-color-scheme: dark)` 匹配 macOS Light/Dark Appearance；
7. **MDX 与未知组件**：不执行交互代码，降级为格式化代码块；
8. **超大文件保护**：单文件超过 2 MB 自动截断并提示，防止快速查看因内存溢出被系统击杀。

> **注意**：mermaid 图表在 QuickLook 中**不渲染为 SVG**（宿主侧无 mermaid 运行时），
> 按契约显示为代码块。这是与桌面导出的已知差异。

---

## 6. 构建流水线与打包规范

1. **Rust 静态库**：`crates/render-ffi`
   - `cargo build --release` 产出 `libmd_render_ffi.a`
   - **必须**设置 `MACOSX_DEPLOYMENT_TARGET=12.0`，与 Swift 的 `-target arm64-apple-macos12.0` 一致；
     不一致会导致链接期告警「built for newer macOS than being linked」，且可能用到旧系统不存在的符号

2. **扩展编译脚本**：`apps/desktop/scripts/build-quicklook.sh`
   - 编译 `crates/render-ffi` 静态库
   - `swiftc -target arm64-apple-macos12.0` 编译 `PreviewProvider.swift` + `main.swift`
   - 链接 `QuickLookUI`、`UniformTypeIdentifiers`、`Foundation` + `-lmd_render_ffi`
   - **不链接 `JavaScriptCore`**（回归测试会断言这一点）
   - 组装 `.appex` 目录并 `codesign --sign -` ad-hoc 签名

3. **Tauri 集成**：
   - `tauri.conf.json` 的 `bundle.fileAssociations` 声明 `.md`, `.markdown`, `.mdown`, `.mkd`
   - `tauri.macos.conf.json` 的 `bundle.macOS.files` 把 `.appex` 注入 `Contents/PlugIns/`

---

## 7. 回归测试

`apps/desktop/tests/quicklook-preview.test.ts` 断言：

- `PreviewProvider.swift` 使用 `@_silgen_name("md_render_document")` 等 C 符号，**不含** `import JavaScriptCore`
- `Resources/quicklook-engine.js` **不存在**
- 构建脚本引用 `crates/render-ffi` / `libmd_render_ffi.a` / `-lmd_render_ffi`，**不含** `-framework JavaScriptCore`
- 构建脚本同时设置 `MACOSX_DEPLOYMENT_TARGET=12.0` 与 `arm64-apple-macos12.0`

渲染结果的等价性由 `scripts/render-diff` 保证（QuickLook 与桌面共用 `crates/render`）。
