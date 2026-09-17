# Inkpoint Android - 原生 Android 客户端

Inkpoint 移动端的 Android 原生工程，基于 **Kotlin + Jetpack Compose + Material Design 3** 构建。

---

## 1. 核心架构与特性

- **Material 3 现代界面**：基于 Jetpack Compose 构建响应式界面与动态色彩（Dynamic Color）主题适配；
- **安全离线资产加载**：通过 `WebViewAssetLoader` 将打包在 `assets/editor/` 中的离线 Webview 内核限制在安全的虚拟域中加载，杜绝本地跨域与网络泄露；
- **软键盘附件工具栏 (`KeyboardAccessoryBar`)**：监听软键盘展开状态（IME Window Insets），在输入法上方自动贴合快捷格式化工具条（H1~H6、粗体、斜体、列表、代码块、撤销等）；
- **系统级触感反馈 (Haptics)**：通过 `Vibrator` 提供精准轻柔的点击触感，具备健全的设备硬件兼容与降级处理；
- **存储访问框架 (SAF)**：直接读写 Android 本地文件或第三方云盘文档，无需授予广泛的全局存储权限。

---

## 2. 工程结构

```
apps/mobile/android/
├── app/
│   ├── build.gradle.kts      # 模块依赖、SDK 目标版本与签名配置
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/editor/    # 前端离线包 (由 pnpm build:mobile 自动同步)
│       └── java/com/inkpoint/editor/
│           ├── MainActivity.kt        # 宿主 Activity、Bridge 分发与触感控制
│           └── ui/
│               ├── EditorWebView.kt   # WebView 封装与通信通道
│               └── KeyboardAccessoryBar.kt # 软键盘顶部快捷格式化栏
├── build.gradle.kts          # 顶级 Gradle 配置
└── gradlew                   # Gradle Wrapper
```

---

## 3. 本地构建与运行

### 前置要求
- **Java JDK 17**
- **Android SDK**（API 34，最低支持 API 26 / Android 8.0）

### 运行调试
```bash
# 启动模拟器或通过 USB 连接真机后运行
pnpm android
# 或在当前目录下：
./gradlew installDebug
```

### 打包发布 APK
```bash
# 打包生成 Universal 测试包
./gradlew assembleDebug

# 打包生产签名包 (需配置环境变量签名密钥)
./gradlew assembleRelease
```
产物输出至：`app/build/outputs/apk/`。
