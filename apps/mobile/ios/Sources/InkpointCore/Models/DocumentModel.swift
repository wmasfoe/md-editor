import Foundation
import Combine

/// 文档数据模型与生命周期状态管理器
@MainActor
public final class DocumentModel: ObservableObject {
    // MARK: - Published Properties

    @Published public var title: String = "Untitled.md"
    @Published public var markdown: String = ""
    @Published public var fileURL: URL? = nil
    @Published public var mode: EditorMode = .read
    @Published public var isDirty: Bool = false
    @Published public var wordCount: Int = 0
    @Published public var headings: [OutlineHeading] = []
    @Published public var isWebViewReady: Bool = false
    @Published public var statusMessage: String? = nil

    // MARK: - Internal Delegate / Bridge Hook

    public var onDispatchAction: ((NativeActionMessage) -> Void)?
    private var saveCompletionHandler: ((Bool) -> Void)?

    public init(initialMarkdown: String? = nil, fileURL: URL? = nil) {
        if let fileURL = fileURL {
            self.fileURL = fileURL
            self.title = fileURL.lastPathComponent
            self.loadFromFile(url: fileURL)
        } else if let initialMarkdown = initialMarkdown {
            self.markdown = initialMarkdown
            self.title = "Sample Document.md"
        } else {
            self.loadSampleDocument()
        }
    }

    // MARK: - Document Loading & Sample

    public func loadSampleDocument() {
        let sample = """
        # 欢迎使用 Inkpoint 移动端 📱

        > 极简、本地优先、所见即所得。秉承**「即览 (Jilan) + 即改」**设计哲学。

        Inkpoint 提供了极致细腻的排版：支持**粗体文本**、*优雅斜体*、~~删除划线~~、==文本高亮强调== 以及 `inline_code()` 行内代码。

        ---

        ### 💡 核心特性与效率技巧

        > [!NOTE]
        > 默认以**沉浸阅读模式**秒级打开文档，零光标遮挡；双击任意段落或点击右下角浮动按钮即可就地激活 CodeMirror 6 极速编辑。

        ::: tip 极客效率指南
        - **双击正文**：直接在双击位置激活就地光标与全键盘编辑
        - **键盘附着工具栏**：支持一键加粗、插入代码块、生成列表与撤销重做
        - **大纲悬浮导航**：点击右上角目录即可快速跳转长篇章节
        :::

        ::: warning 本地优先隐私承诺
        移动端贯彻 **Local-First** 纯离线原则，所有修改直接就地持久化在设备文件系统中，不依赖外部服务器，完全保障数据私密性。
        :::

        ---

        ### 📐 LaTeX 科学数学公式

        行内公式如质能方程 $E = mc^2$，欧拉恒等式 $e^{i\\pi} + 1 = 0$。

        块级数学公式支持复杂微积分与求和：

        $$
        \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}, \\quad \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
        $$

        ---

        ### 💻 多语言代码高亮

        ```typescript
        // Type-Safe JSBridge 离线通信架构
        export interface InkpointBridge {
          execCommand(command: "bold" | "italic" | "h1" | "code"): void;
          notifyOutline(items: OutlineItem[]): void;
        }
        ```

        ```swift
        // iOS 原生键盘附着工具栏交互
        @Observable
        final class DocumentModel {
            var markdown: String = ""
            var isDirty: Bool = false
            
            func save() {
                // 就地持久化到沙盒文件
            }
        }
        ```

        ```rust
        // Tauri 原生极速离线内核
        fn render_markdown_securely(raw: &str) -> Result<String, String> {
            println!("Inkpoint local-first engine active.");
            Ok(raw.to_string())
        }
        ```

        ---

        ### 📊 Mermaid 交互式流程图

        ```mermaid
        graph TD
          A[📄 本地 Markdown] --> B(⚡️ 沉浸即览)
          B -->|双击就地激发| C{📝 CM6 编辑}
          C -->|键盘工具栏操作| D[✨ 实时所见即所得]
          D -->|自动无感保存| E[💾 本地文件存储]
        ```

        ---

        ### 📋 结构化数据与任务清单

        | 平台模块 | 技术栈 | 启动耗时 | 渲染引擎 |
        | :--- | :--- | :--- | :--- |
        | **iOS App** | SwiftUI 6 + WKWebView | < 80ms | CodeMirror 6 |
        | **Android App** | Jetpack Compose + WebView | < 90ms | CodeMirror 6 |
        | **Desktop 端** | Tauri 2.0 + Rust + React | < 120ms | CodeMirror 6 |

        - [x] CodeMirror 6 移动端极速自绘选区
        - [x] 官方插件全面接入（高亮、容器指令、KaTeX、Mermaid）
        - [x] 原生键盘附着工具栏与弹簧手感触控反馈
        - [ ] 跨端本地局域网点对点实时协作
        """
        self.markdown = sample
        self.title = "Welcome.md"
        self.isDirty = false
        self.wordCount = sample.count
    }

    public func loadFromFile(url: URL) {
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer {
            if hasAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let content = try String(contentsOf: url, encoding: .utf8)
            self.markdown = content
            self.fileURL = url
            self.title = url.lastPathComponent
            self.isDirty = false
            self.wordCount = content.count

            if isWebViewReady {
                syncToWebView()
            }
        } catch {
            self.statusMessage = "加载文档失败: \(error.localizedDescription)"
        }
    }

    // MARK: - Webview Sync & Actions

    public func notifyWebViewReady() {
        self.isWebViewReady = true
        syncToWebView()
    }

    public func syncToWebView() {
        let payload: [String: AnyCodable] = [
            "markdown": .string(markdown),
            "content": .string(markdown),
            "mode": .string(mode.rawValue),
            "initialMode": .string(mode.rawValue),
            "title": .string(title)
        ]
        let action = NativeActionMessage(action: "loadDocument", payload: payload)
        onDispatchAction?(action)
    }

    public func toggleMode() {
        let nextMode: EditorMode = (mode == .read) ? .edit : .read
        setMode(nextMode)
    }

    public func setMode(_ newMode: EditorMode) {
        guard mode != newMode else { return }
        mode = newMode
        let payload: [String: AnyCodable] = ["mode": .string(newMode.rawValue)]
        let action = NativeActionMessage(action: "setMode", payload: payload)
        onDispatchAction?(action)
    }

    public func executeCommand(_ command: MarkdownCommand) {
        let payload: [String: AnyCodable] = ["command": .string(command.rawValue)]
        let action = NativeActionMessage(action: "execCommand", payload: payload)
        onDispatchAction?(action)
    }

    public func scrollToHeading(_ headingId: String) {
        let payload: [String: AnyCodable] = ["headingId": .string(headingId)]
        let action = NativeActionMessage(action: "scrollToHeading", payload: payload)
        onDispatchAction?(action)
    }

    // MARK: - Save Operations

    public func requestSave(completion: ((Bool) -> Void)? = nil) {
        self.saveCompletionHandler = completion
        let action = NativeActionMessage(action: "requestContent", payload: [:])
        onDispatchAction?(action)
    }

    public func handleSaveResponse(markdown: String, isSuccess: Bool) {
        if isSuccess {
            self.markdown = markdown
            self.isDirty = false

            // 若有关联真实文件路径，持久化写入本地磁盘
            if let fileURL = self.fileURL {
                let hasAccess = fileURL.startAccessingSecurityScopedResource()
                defer {
                    if hasAccess {
                        fileURL.stopAccessingSecurityScopedResource()
                    }
                }

                do {
                    try markdown.write(to: fileURL, atomically: true, encoding: .utf8)
                    self.statusMessage = "已保存"
                    saveCompletionHandler?(true)
                } catch {
                    self.statusMessage = "写入文件失败: \(error.localizedDescription)"
                    saveCompletionHandler?(false)
                }
            } else {
                self.statusMessage = "文档内容已更新"
                saveCompletionHandler?(true)
            }
        } else {
            saveCompletionHandler?(false)
        }
        self.saveCompletionHandler = nil
    }

    public func handleContentChange(isDirty: Bool, wordCount: Int) {
        self.isDirty = isDirty
        self.wordCount = wordCount
    }

    public func handleOutlineExtracted(headings: [OutlineHeading]) {
        self.headings = headings
    }
}
