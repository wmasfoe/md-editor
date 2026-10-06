import SwiftUI
import Foundation
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
        LaunchDiagnostics.mark("webview: makeUIView 开始")
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()

        // 注册 JSBridge 消息监听
        contentController.add(bridgeController, name: "InkpointBridge")
        config.userContentController = contentController

        // 编辑器静态资源改由自定义 scheme 伺服（inkpoint://editor/…）。
        // file:// 下 ES module 会被 CORS 拦截（旧的私有开关在新系统已不存在），
        // 结果是页面白屏、Bridge 缺失。详见 EditorSchemeHandler。
        let editorRoot = Self.editorResourceRoot()
        if let editorRoot = editorRoot {
            config.setURLSchemeHandler(
                EditorSchemeHandler(rootDirectory: editorRoot),
                forURLScheme: EditorSchemeHandler.scheme
            )
        }

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
        loadEditorBundle(in: webView, editorRoot: editorRoot)

        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        LaunchDiagnostics.mark("webview: makeUIView 完成")
        return webView
    }

    /// 编辑器静态资源根目录（App Bundle 内的 Resources/editor）
    private static func editorResourceRoot() -> URL? {
        Bundle.main
            .url(forResource: "index", withExtension: "html", subdirectory: "editor")?
            .deletingLastPathComponent()
    }

    public func updateUIView(_ uiView: WKWebView, context: Context) {
        // 动态状态通过 JSBridge 双向推送，无需在此强制重载
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    private func loadEditorBundle(in webView: WKWebView, editorRoot: URL?) {
        // 1. 首选：自定义 scheme（ES module / 动态 import / 字体全部可用）
        if let editorRoot = editorRoot,
           let schemeURL = URL(string: "\(EditorSchemeHandler.scheme)://\(EditorSchemeHandler.host)/index.html") {
            LaunchDiagnostics.mark("webview: 经自定义 scheme 加载编辑器资源（\(editorRoot.path)）")
            webView.load(URLRequest(url: schemeURL))
            return
        }

        // 2. 兜底：file:// 直载（仅经典脚本可用；ES module 会被 CORS 拦截）
        if let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "editor") {
            let folderURL = htmlURL.deletingLastPathComponent()
            LaunchDiagnostics.mark("webview: 命中编辑器资源 \(htmlURL.path)")
            webView.loadFileURL(htmlURL, allowingReadAccessTo: folderURL)
            return
        }

        // 3. 容底：展示友好的离线提示
        LaunchDiagnostics.mark("webview: 未找到编辑器资源，使用兜底页面")
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
            LaunchDiagnostics.mark("webview: 页面加载完成")
            print("[EditorWebView] HTML Bundle navigation did finish")
        }

        public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            LaunchDiagnostics.mark("webview: 页面加载失败 \(error.localizedDescription)")
            print("[EditorWebView] Navigation failed:", error)
        }

        /// WebContent 进程崩溃/被系统回收（页面白屏的常见原因）
        public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            LaunchDiagnostics.mark("webview: WebContent 进程已终止")
        }

        /// 预加载导航失败（例如本地资源协议被拒）
        public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            LaunchDiagnostics.mark("webview: 预加载导航失败 \(error.localizedDescription)")
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
