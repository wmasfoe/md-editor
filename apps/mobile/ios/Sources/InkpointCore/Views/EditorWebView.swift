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

        // 允许本地静态资源访问（离线编辑器需要读 file:// 下的子资源）。
        // ⚠️ allowFileAccessFromFileURLs / allowUniversalAccessFromFileURLs 是 WebKit 的
        // **私有属性**，不同 iOS 版本并不保证存在；直接 setValue(_:forKey:) 一旦碰到不存在的
        // key 会抛 NSUnknownKeyException —— Swift 捕不到，表现为「启动即闪退」。
        // 所以这里先探测 responds(to:) 再写，键不存在就跳过（最多退化为子资源受限，不会崩）。
        setPrivateWebKitFlag(on: config.preferences, key: "allowFileAccessFromFileURLs")
        setPrivateWebKitFlag(on: config, key: "allowUniversalAccessFromFileURLs")

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

        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        LaunchDiagnostics.mark("webview: makeUIView 完成")
        return webView
    }

    /// 写入 WebKit 私有属性前先探测是否存在，避免 KVC 抛 NSUnknownKeyException 导致闪退。
    @discardableResult
    private func setPrivateWebKitFlag(on object: NSObject, key: String) -> Bool {
        guard object.responds(to: NSSelectorFromString(key)) else {
            LaunchDiagnostics.mark("webview: 当前系统不响应私有属性 \(key)，已跳过")
            return false
        }
        object.setValue(true, forKey: key)
        LaunchDiagnostics.mark("webview: 已开启私有属性 \(key)")
        return true
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
            LaunchDiagnostics.mark("webview: 命中编辑器资源 \(htmlURL.path)")
            webView.loadFileURL(htmlURL, allowingReadAccessTo: folderURL)
            return
        }

        // 2. 备用相对路径查找（用于测试或非标准构建环境）
        if let directURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            LaunchDiagnostics.mark("webview: 资源位于 bundle 根目录 \(directURL.path)")
            webView.loadFileURL(directURL, allowingReadAccessTo: directURL.deletingLastPathComponent())
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
