# @md-editor/desktop - Inkpoint 桌面客户端

基于 [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) + [React 19](https://react.dev/) 构建的 Inkpoint 官方跨平台桌面客户端。

---

## 1. 架构特点

- **极致原生性能**：相较传统基于 Electron 的编辑器（数十 MB 内存占用与数秒冷启动），Inkpoint 桌面端基于系统 WebView 与 Rust 原生线程，内存占用降低 70%+，启动毫秒级响应；
- **原生窗口沉浸设计**：
  - macOS 端：深度定制 Liquid Glass 材质、毛玻璃通栏与隐藏式标题栏（Titlebar）；
  - Windows / Linux 端：原生自定义无边框窗口控件（最小化、最大化、关闭）；
- **本地优先与多标签管理**：内置工作区目录树、多文档标签页（Tabs）、实时修改自动保存与最近打开文件恢复；
- **macOS QuickLook 快速预览集成**：内置基于 `@md-editor/compiler` 构建的快速预览扩展，支持在 Finder 中按空格键即时渲染 `.md` / `.mdx` 文件；
- **内置静默差量更新**：通过 Cloudflare R2 边缘网关与 GitHub Release 双通道支持自动检查与平滑热升级。

---

## 2. 目录结构

```
apps/desktop/
├── src/                      # 前端 React 19 视图层 (Shell、App 布局、设置弹窗)
├── src-tauri/                # Rust 原生底层 (Tauri 2 核心、窗口控制、文件系统通道)
│   ├── Cargo.toml            # Rust 依赖配置
│   ├── tauri.conf.json       # 开发配置
│   ├── tauri.release.conf.json # 发布与差量更新签名配置
│   └── binaries/             # 预编译辅助二进制
├── scripts/                  # macOS QuickLook 构建与测试脚本
├── e2e/                      # Playwright 桌面端端到端测试套件
└── tests/                    # Vitest 单元测试
```

---

## 3. 本地开发与调试

### 前置环境要求
- **Node.js**：18+
- **pnpm**：11.6.0+
- **Rust 工具链**：`rustc` & `cargo` 最新稳定版（建议通过 `rustup` 安装）

### 启动桌面端调试
```bash
# 在仓库根目录下启动（自动启动 Vite 并唤起 Tauri 原生桌面窗口）
pnpm dev

# 或者仅启动前端 Web 界面调试
pnpm --filter @md-editor/desktop dev
```

---

## 4. 生产构建

```bash
# macOS 打包（生成 .dmg 与 updater 升级包）
pnpm build:macos

# Windows 打包（生成 NSIS .exe 安装程序）
pnpm build:windows

# Linux 打包（生成 .AppImage 与 .deb 软件包）
pnpm build:linux
```

---

## 5. 测试与代码检查

```bash
# 单元测试
pnpm --filter @md-editor/desktop test

# 类型检查
pnpm --filter @md-editor/desktop typecheck

# 端到端测试 (Playwright)
pnpm --filter @md-editor/desktop test:browser
```
