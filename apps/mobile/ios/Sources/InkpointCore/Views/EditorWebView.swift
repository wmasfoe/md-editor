import SwiftUI
#if canImport(WebKit)
import WebKit
#endif

/// SwiftUI 包装的 WKWebView 容器，承载离线 CodeMirror 6 编辑/阅读渲染器
#if canImport(UIKit)
public struct EditorWebView: UIViewRepresentable {
    @ObservedObject public var documentModel: DocumentModel
    public let bridgeController: InkpointBridgeController

    public init(documentModel: DocumentModel, bridgeController: InkpointBridgeController) {
        self.documentModel = documentModel
        self.bridgeController = bridgeController
    }

    public func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()

        // 注册 JSBridge 消息监听
        contentController.add(bridgeController, name: "InkpointBridge")
        config.userContentController = contentController

        // 允许本地静态资源访问
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.scrollView.keyboardDismissMode = .interactive

        // 绑定 Bridge 控制器与文档模型
        bridgeController.webView = webView
        documentModel.onDispatchAction = { [weak bridgeController] action in
            bridgeController?.dispatchAction(action)
        }

        // 加载离线前端页面
        loadEditorBundle(in: webView)

        return webView
    }

    public func updateUIView(_ uiView: WKWebView, context: Context) {
        // 动态状态通过 JSBridge 双向推送，无需在此强制重载
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    private func loadEditorBundle(in webView: WKWebView) {
        // 1. 优先从 App Bundle 的 Resources/editor 查找
        if let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "editor") {
            let folderURL = htmlURL.deletingLastPathComponent()
            webView.loadFileURL(htmlURL, allowingReadAccessTo: folderURL)
            return
        }

        // 2. 备用相对路径查找（用于测试或非标准构建环境）
        if let directURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(directURL, allowingReadAccessTo: directURL.deletingLastPathComponent())
            return
        }

        // 3. 容底：展示友好的离线提示
        let fallbackHTML = """
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="font-family:system-ui;padding:24px;color:#666;">
            <h2>Inkpoint 离线容器</h2>
            <p>正在初始化编辑器资源，请稍候...</p>
        </body>
        </html>
        """
        webView.loadHTMLString(fallbackHTML, baseURL: nil)
    }

    public class Coordinator: NSObject, WKNavigationDelegate {
        var parent: EditorWebView

        init(_ parent: EditorWebView) {
            self.parent = parent
        }

        public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[EditorWebView] HTML Bundle navigation did finish")
        }

        public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[EditorWebView] Navigation failed:", error)
        }
    }
}
#elseif canImport(AppKit)
public struct EditorWebView: NSViewRepresentable {
    @ObservedObject public var documentModel: DocumentModel
    public let bridgeController: InkpointBridgeController

    public init(documentModel: DocumentModel, bridgeController: InkpointBridgeController) {
        self.documentModel = documentModel
        self.bridgeController = bridgeController
    }

    public func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(bridgeController, name: "InkpointBridge")
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        bridgeController.webView = webView
        documentModel.onDispatchAction = { [weak bridgeController] action in
            bridgeController?.dispatchAction(action)
        }
        return webView
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
