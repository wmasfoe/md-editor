# Inkpoint Mobile - 移动端套件

> [!IMPORTANT]
> **移动端不再发版**：最后发布的版本是 0.2.1（Android APK、iOS 未签名 IPA），仍可在[官网下载页](https://editor.jiaqi.im/#download)获取。之后的版本需要自行编译，见下方「3. 构建安装包」。

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
pnpm dev:android

# 启动 iOS 模拟器调试 (macOS 专属)
pnpm dev:ios
```

---

## 4. 构建安装包

```bash
# Android: 输出 dist-mobile/Inkpoint_<version>.apk（Debug 签名，需要 JDK 17 与 Android SDK）
pnpm build:android

# iOS: 输出 dist-mobile/Inkpoint-<version>-unsigned.ipa（未签名，需要 macOS 与 Xcode）
pnpm build:ios
```

版本号取自 `apps/mobile/android/app/build.gradle.kts` 的 `versionName` 与 Xcode 工程的 `MARKETING_VERSION`，可用 `--version <x.y.z>` 覆盖。两个脚本会先执行 `pnpm build:mobile` 同步前端资源，已同步过可加 `--no-sync`。

未签名的 IPA 不能直接装到真机，需要用 Sideloadly、AltStore 等工具用自己的 Apple ID 重签；免费 Apple ID 的签名 7 天有效。
