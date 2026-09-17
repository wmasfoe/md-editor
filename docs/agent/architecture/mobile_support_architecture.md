# 移动端 (iOS & Android) 原生外壳与离线内核架构方案

## 1. 架构定位与设计哲学

Inkpoint 移动端整体架构秉持 **“即览 (Jilan)”** 产品哲学：
- **Markdown 作为核心数据层**：纯文本数据，不绑定任何私有云格式与私有账号系统，零登录门槛，即开即览；
- **HTML / Web 技术栈作为高表现力渲染层**：复用桌面端成熟的 `@md-editor/renderer-codemirror`（静态阅读态与交互编辑态）与 Markdown 语法插件体系，确保桌面端与移动端 100% 渲染与排版一致性；
- **原生外壳提供极致触感与系统级深度集成**：iOS 采用 Swift 6 + SwiftUI，Android 采用 Kotlin + Jetpack Compose，提供原生弹簧微动效、软键盘顶起工具栏（InputAccessoryView / IME Insets）、系统级触感反馈（Haptics）、系统文件安全持久化（iOS In-Place Document / Android SAF）以及系统级分享扩展（Share Extension）。

---

## 2. 模块拓扑与工作区分工

```
md-editor/
├── apps/
│   ├── mobile-web/             # [Phase 1] 移动端 Web 离线容器（CM6 + Bridge）
│   │   ├── src/
│   │   │   ├── bridge/         # 双向类型安全通信协议 (InkpointBridge.ts)
│   │   │   ├── components/     # ReaderCanvas (静态阅读态) + EditorCanvas (交互编辑态)
│   │   │   └── App.tsx         # 双态调度与 Bridge 事件挂载
│   │   └── dist/               # 离线打包产物 (零外部网络请求，Gzip < 730KB)
│   ├── ios/                    # [Phase 2 & 4] iOS 原生工程 (SwiftUI + WKWebView)
│   │   ├── Inkpoint/           # 宿主应用入口与核心视图
│   │   ├── Sources/            # InkpointCore 库 (Bridge/Models/Views)
│   │   ├── ShareExtension/     # 系统级分享扩展 (文件App/微信点击“用 Inkpoint 打开”)
│   │   └── Resources/editor/   # 由 sync-mobile-web 自动同步的前端离线资源
│   └── android/                # [Phase 3] Android 原生工程 (Compose + SAF)
│       └── app/
│           ├── src/main/java/  # Bridge, SAF DocumentViewModel, Compose 界面
│           └── src/main/assets/editor/ # 离线资源包 (通过 WebViewAssetLoader 安全隔离访问)
└── scripts/mobile/
    └── sync-mobile-web.mjs     # 跨平台静态产物自动分发脚本
```

---

## 3. 双向类型安全通信协议 (InkpointBridge)

通信契约严格按照 `contracts.ts` 定义，原生端（Swift/Kotlin）与前端（TypeScript）保持 1:1 类型镜像：

### 3.1 原生向 Web 发出的 Action (Native -> Web)
- `loadDocument(markdown, mode, title)`: 注入文档内容与初始模式
- `setMode(mode: "read" | "edit")`: 切换阅读态与编辑态
- `execCommand(command: MarkdownCommand)`: 触发格式化指令（h1, h2, bold, italic, strikethrough, code, quote, bulletList, orderedList, taskList, link, table, hr）
- `requestContent`: 原生请求最新 Markdown 内容以准备持久化保存
- `scrollToHeading(headingId)`: 大纲导航跳转

### 3.2 Web 向原生反馈的 Event (Web -> Native)
- `ready`: 前端 DOM 与 CM6 初始化就绪
- `contentChange(isDirty, wordCount)`: 用户输入触发脏标记与实时字数统计
- `saveResponse(markdown, isSuccess)`: 回传最新文档字符串供原生写入磁盘
- `haptic(type)`: 触发原生振动马达（impactLight, impactMedium, selection 等）
- `outlineExtracted(headings)`: 提炼文档各级标题列表，供原生侧滑抽屉/大纲导航使用
- `openUrl(url)`: 拦截外部超链接，交由系统默认浏览器打开
- `error(message, stack, componentStack)`: 前端 ErrorBoundary 捕获未处理异常并上报原生日志与调试系统

---

## 4. iOS 平台深度特性

1. **WKWebView 离线托管**：使用 `loadFileURL(..., allowingReadAccessTo: ...)` 离线载入本地资源，杜绝外部 CDN 延迟；
2. **UIInputAccessoryView 弹簧工具栏**：SwiftUI 中通过 `.toolbar { ToolbarItemGroup(placement: .keyboard) { KeyboardAccessoryBar(...) } }` 深度联动 iOS 软键盘，平滑升降；
3. **触感反馈引擎**：按键点击触发 `UIImpactFeedbackGenerator(style: .light)`，模式切换触发 `.medium`，大纲选中触发 `UISelectionFeedbackGenerator`；
4. **系统级文档就地编辑**：配置 `LSSupportsOpeningDocumentsInPlace: true` 与 `UIFileSharingEnabled: true`，结合 `UIDocumentPickerViewController` 原地读写 iCloud Drive / 本地文件；
5. **系统分享扩展 (Share Extension)**：支持在微信或“文件”App 中将选中文本或 `.md` 文件通过深度链接与 App Group 共享直接导入。

---

## 5. Android 平台深度特性

1. **WebViewAssetLoader 域名隔离**：通过 `https://appassets.androidplatform.net/assets/editor/index.html` 访问打包资产，规避 `file://` 同源策略安全限制；
2. **Storage Access Framework (SAF) 权限保持**：
   - 接入 `ActivityResultContracts.OpenDocument()`；
   - 通过 `takePersistableUriPermission` 保持长久读写权限；
   - 原地通过 `contentResolver.openOutputStream(uri, "wt")` 安全保存，无需申请危险的全局存储权限；
3. **IME Insets 响应式软键盘栏**：使用 Compose `WindowInsets.ime` 与 `AnimatedVisibility(slideInVertically)` 实现工具栏与输入法无缝吸附；
4. **VibratorManager 触感反馈与安全容灾**：声明 `android.permission.VIBRATE` 权限；针对 Android 10+ 适配 `VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK / EFFECT_CLICK)`，并通过全局异常兜底确保硬件受限或系统无震动马达时不引发 Crash。

---

## 6. CI/CD 自动化验证与打包流水线

流水线配置于 `.github/workflows/mobile-ci.yml`：
- **`mobile-web-build`** (Ubuntu)：构建前端移动端包，执行 Vitest 桥接单测，校验 Gzip 体积并上传工件；
- **`ios-ci`** (macOS 14)：执行 Swift 契约单测 (`swift run InkpointContractTests`)，编译 iOS 模拟器产物验证 Xcode 构建无误；
- **`android-ci`** (Ubuntu + JDK 17)：执行 Android JUnit 单元测试 (`./gradlew testDebugUnitTest`) 并打包调试版 APK (`./gradlew assembleDebug`)。
