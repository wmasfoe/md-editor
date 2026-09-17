# @md-editor/mobile-core - 移动端 Web 离线内核

Inkpoint 移动端混合架构中的前端渲染与编辑内核。作为嵌入 iOS (WKWebView) 与 Android (WebView) 的轻量级单页容器，提供双向通信桥接（Bridge）、静态阅读态与交互编辑态平滑切换。

---

## 1. 架构定位与设计考量

- **双模态无缝切换**：
  - **阅读态 (`ReaderCanvas`)**：纯静态渲染，零光标抖动，专为移动端单手长文滑读优化；
  - **编辑态 (`EditorCanvas`)**：按需激活 CodeMirror 6 编辑器实例，联动软键盘唤起与选区聚焦；
- **全端错误边界隔离 (`ErrorBoundary`)**：在移动端 Webview 中，插件语法异常或渲染失败不会导致整页白屏，而是优雅呈现重试卡片，并通过 Bridge 向原生端自动上报异常日志；
- **触控优化**：专为小屏幕手势优化的滑动大纲导航、触感反馈（Haptics 调度）与长按选择保护。

---

## 2. 通信桥接契约 (InkpointBridge)

通信契约严格镜像于原生端（Swift 与 Kotlin）：

| 方向 | 消息类型 | 作用说明 |
| :--- | :--- | :--- |
| **Native → Web** | `loadDocument` | 注入 Markdown 初始文本与阅读/编辑模式 |
| **Native → Web** | `setMode` | 切换 `read`（阅读）与 `edit`（编辑）状态 |
| **Native → Web** | `execCommand` | 执行标题、粗体、列表、公式等快速格式化指令 |
| **Native → Web** | `requestContent` | 原生通知前端回传最新内容以供本地保存 |
| **Web → Native** | `ready` | Web 容器初始化与 DOM 挂载就绪信号 |
| **Web → Native** | `contentChange` | 用户键入触发脏状态（`isDirty`）与字数统计上报 |
| **Web → Native** | `saveResponse` | 回传当前 Markdown 纯文本供原生写入磁盘 |
| **Web → Native** | `haptic` | 请求原生震动马达执行触感反馈 |
| **Web → Native** | `error` | 上报未捕获异常堆栈 |

---

## 3. 本地开发与构建

```bash
# 启动本地浏览器端预览
pnpm dev

# 执行生产打包 (输出至 dist)
pnpm build

# 运行单元测试
pnpm test

# 执行类型检查
pnpm typecheck
```
