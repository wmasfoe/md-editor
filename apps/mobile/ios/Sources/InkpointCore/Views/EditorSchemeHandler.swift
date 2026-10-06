#if canImport(WebKit)
import Foundation
import WebKit

/// 用自定义 URL scheme（`inkpoint://editor/…`）伺服 App 内置的编辑器静态资源。
///
/// 为什么不能用 `file://`：构建产物是 **ES module**（`<script type="module">`），
/// WebKit 在 file:// 下会按 CORS 规则拦截 module 脚本（file 源被视为不透明 origin），
/// 表现为：页面「加载完成」但 JS 从不执行 —— 白屏、`window.InkpointBridge` 不存在、
/// 编辑器与键盘都不工作（实测日志：`setMode 的 JS 已执行 -> missing`）。
///
/// 传统解法是 WebKit 私有开关 `allowFileAccessFromFileURLs`，但该属性在 iOS 26+ 已不存在。
/// 自定义 scheme 让所有资源处于同一 origin，module / 动态 import / 字体全部正常，
/// 这也是 Capacitor 等框架的标准做法（Android 侧对应 `WebViewAssetLoader`）。
final class EditorSchemeHandler: NSObject, WKURLSchemeHandler {
    /// 自定义 scheme 与 host：`inkpoint://editor/index.html`
    static let scheme = "inkpoint"
    static let host = "editor"

    /// 静态资源根目录（App Bundle 内的 Resources/editor）
    private let rootDirectory: URL

    init(rootDirectory: URL) {
        self.rootDirectory = rootDirectory.standardizedFileURL
        super.init()
    }

    // MARK: - WKURLSchemeHandler

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(Self.makeError("缺少请求 URL"))
            return
        }

        let relativePath = Self.relativePath(from: url)
        let fileURL = rootDirectory.appendingPathComponent(relativePath).standardizedFileURL

        // 防目录穿越：解析后的路径必须仍在资源根目录内
        guard fileURL.path.hasPrefix(rootDirectory.path) else {
            urlSchemeTask.didFailWithError(Self.makeError("非法路径：\(relativePath)"))
            return
        }

        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(Self.makeError("资源不存在：\(relativePath)"))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": Self.mimeType(for: fileURL.pathExtension),
                // 同源场景下并非必需，但显式给出可避免被当成跨源资源时的意外拦截
                "Access-Control-Allow-Origin": "*",
            ]
        )
        if let response = response {
            urlSchemeTask.didReceive(response)
        }
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // 资源为一次性同步读取，无需处理取消
    }

    // MARK: - Helpers

    /// `inkpoint://editor/a/b.js` → `a/b.js`；空路径回退到 `index.html`
    private static func relativePath(from url: URL) -> String {
        let decoded = url.path.removingPercentEncoding ?? url.path
        let trimmed = String(decoded.drop(while: { $0 == "/" }))
        return trimmed.isEmpty ? "index.html" : trimmed
    }

    /// 扩展名 → MIME。module 脚本必须给出 JS 类型，否则会被拒绝执行。
    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json", "map": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        default: return "application/octet-stream"
        }
    }

    private static func makeError(_ message: String) -> NSError {
        NSError(
            domain: "inkpoint.editor.scheme",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
#endif
