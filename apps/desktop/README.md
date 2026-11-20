# @md-editor/desktop

Inkpoint 桌面应用，由 Rust + [GPUI Kit](https://gpui-kit.com/) 原生渲染。编辑器与浏览器 Playground
共用同一套 Rust 文档模型和视图：`packages/editor-core`（文档与格式操作）、`packages/editor-gpui`
（编辑器视图）、`packages/editor-web`（WASM 入口）。

> Tauri + React + CodeMirror 的旧宿主已在本分支退役。稳定渠道的历史实现仍在 `main`。

## 能力

- **本地文件。** 打开 Markdown 文件或目录，目录以树形展示；保存走「另存 / 保存」显式触发，
  保留原文件的 BOM 与 CRLF；外部修改会在保存时检测并阻止覆盖。
- **编辑。** 所见即所得编辑器支持撤销与重做；表格支持按单元格编辑；
  大纲可跳转。富文本按区块激活输入，激活后编辑强调/链接/公式时仍会显示该区块的 Markdown 标记。
- **图片。** 粘贴图片写入工作区 `assets/`，以相对路径插入引用。
- **本地 AI。** 通过 llama.cpp 子进程做续写，复用既有 Lite（FIM）与 Standard 接口，
  模型由用户在设备上安装。
- **Finder 集成。** 支持通过「打开方式」和启动参数打开文件。

## 目录

```
apps/desktop/
├── src/                  # GPUI 宿主：main / workspace / document / folder / image_assets / local_ai
├── tests/                # Rust 集成测试（文档保存、图片资源）
├── assets/               # AppIcon.icns
├── runtime/llama/        # llama.cpp sidecar 与 dylib（打包时拷入 app bundle）
└── scripts/
    └── package-macos.mjs # 生成 .app 与 DMG（ad-hoc 签名）
```

## 开发

需要 Node（见 `.node-version`）、pnpm 11.6.0、Rust 1.98.0。

```bash
pnpm dev:desktop     # 启动原生窗口
pnpm test:rust       # Rust workspace 测试
pnpm lint            # oxlint + prettier + 结构守卫 + cargo fmt/clippy
```

## 打包

```bash
node scripts/release/prepare-llama-runtime.mjs --target aarch64-apple-darwin
cargo build --locked --release --target aarch64-apple-darwin --package inkpoint-gpui
GPUI_VERSION=0.23.5 CARGO_BUILD_TARGET=aarch64-apple-darwin node apps/desktop/scripts/package-macos.mjs
```

产物在 `target/gpui-preview/`。当前使用 ad-hoc 签名与独立 bundle ID
（`com.inkpoint.gpui-preview`），不与稳定版 Inkpoint 冲突，也没有 Developer ID 公证。

## 尚未迁移

自动更新器、外部插件宿主与预览、风格学习、会话/草稿恢复、文档历史、
命令面板、PDF/HTML 导出、Quick Look 扩展、Sentry 上报。
