# Inkpoint Mobile - 移动端套件

Inkpoint 移动端套件采用 **“即览 (Jilan)”** 设计哲学与 **混合架构 (Hybrid Web + Native Shell)**：
- **Web 离线内核 (`apps/mobile/core`)**：复用桌面端成熟的 `@md-editor/renderer-codemirror` 与 `@md-editor/syntax-plugins`，确保移动端与桌面端 100% 渲染一致与零格式损坏；
- **Android 原生应用 (`apps/mobile/android`)**：基于 Kotlin + Jetpack Compose 构建，提供软键盘快捷工具栏（`KeyboardAccessoryBar`）、系统级震动触感（Haptics）与存储访问框架（SAF）；
- **iOS 原生应用 (`apps/mobile/ios`)**：基于 Swift 6 + SwiftUI 构建，提供原生弹簧微动效、系统分享扩展（Share Extension）与 WKWebView 类型安全通信。

---

## 1. 模块组织

```
apps/mobile/
├── core/                # @md-editor/mobile-core: 移动端 Web 离线容器与通信桥接
├── android/             # Android 原生工程 (Kotlin + Jetpack Compose + SAF)
└── ios/                 # iOS 原生工程 (Swift 6 + SwiftUI + Share Extension)
```

---

## 2. 工作流与构建同步机制

移动端原生外壳通过离线静态资源包运行 Web 内核，不依赖任何外部网络。

每次修改 `apps/mobile/core` 后，执行以下命令即可一键完成前端打包并同步到 iOS 和 Android 原生工程的 assets 目录中：

```bash
# 编译移动端前端并自动同步静态资源至 android 与 ios 工程
pnpm build:mobile
```

该命令会自动触发 `scripts/mobile/sync-mobile-web.mjs`，将产物分发至：
- `apps/mobile/android/app/src/main/assets/editor/`
- `apps/mobile/ios/Inkpoint/Resources/editor/`

---

## 3. 本地调试指南

```bash
# 启动移动端 Web 内核本地调试 (支持浏览器端预览与热更新)
pnpm --filter @md-editor/mobile-core dev

# 启动 Android 模拟器/真机调试
pnpm android
# 或
pnpm dev:android

# 启动 iOS 模拟器/真机调试 (macOS 专属)
pnpm ios
# 或
pnpm dev:ios
```
