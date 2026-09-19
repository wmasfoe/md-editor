# Inkpoint iOS - 原生 iOS 客户端

Inkpoint 移动端的 iOS 原生工程，基于 **Swift 6 + SwiftUI + WebKit (WKWebView)** 构建。

---

## 1. 核心架构与特性

- **SwiftUI 现代声明式架构**：完全采用 SwiftUI 构建主界面与交互流，提供 Apple 官方人机界面指南（HIG）原生体验与弹簧物理动效；
- **类型安全 WKWebView 桥接**：基于 WebKit `WKScriptMessageHandler` 实现与前端内核的双向安全通信通道；
- **契约测试保障 (`InkpointContractTests`)**：使用 Swift Package Manager 原生测试套件验证原生与 Web 桥接消息模型 100% 符合规范；
- **系统级分享扩展 (Share Extension)**：支持在系统“文件”App、Safari 浏览器或微信等第三方应用中点击 Markdown 文件选择“使用 Inkpoint 打开”实现就地预览；
- **触感引擎 (UIFeedbackGenerator)**：根据操作层级触发 `UIImpactFeedbackGenerator` 与 `UISelectionFeedbackGenerator` 细腻触感。

---

## 2. 工程结构

```
apps/mobile/ios/
├── Inkpoint/                 # 主宿主 App 项目文件
├── Sources/                  # 核心 Swift 库模块 (通信桥接、模型、视图)
├── ShareExtension/           # 系统分享扩展组件
├── Tests/                    # 桥接协议契约单元测试
├── Inkpoint.xcodeproj        # Xcode 项目工程
└── Package.swift             # SPM 依赖与构建配置
```

---

## 3. 本地构建与运行

### 前置要求
- **macOS** 与最新 **Xcode** (支持 Swift 6)

### 运行契约单测
```bash
cd apps/mobile/ios
swift test
```

### 启动模拟器调试
```bash
# 在仓库根目录下启动模拟器
pnpm ios
```
或者直接使用 Xcode 打开 `apps/mobile/ios/Inkpoint.xcodeproj` 选择目标模拟器或真机点击 Run。
