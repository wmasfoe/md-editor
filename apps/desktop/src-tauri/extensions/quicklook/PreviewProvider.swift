import Foundation
import QuickLookUI
import UniformTypeIdentifiers
import JavaScriptCore

/// Inkpoint Quick Look Preview Provider
/// Conforms to macOS 12+ QLPreviewProvider protocol to deliver instant, high-fidelity
/// Markdown previews in Finder via our shared static renderer engine (packages/renderer-codemirror/static).
@objc(PreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {

    private static let maxPreviewBytes = 2 * 1024 * 1024 // 2MB safety threshold

    // Shared JavaScriptCore engine running our bundled static renderer
    private static let engine = QuickLookEngine()

    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let fileURL = request.fileURL
        let filename = fileURL.lastPathComponent

        // Read file with size check
        let fileData = try Data(contentsOf: fileURL, options: .mappedIfSafe)
        let isTruncated = fileData.count > Self.maxPreviewBytes
        let safeData = isTruncated ? fileData.prefix(Self.maxPreviewBytes) : fileData

        var markdownText = String(decoding: safeData, as: UTF8.self)
        if isTruncated {
            markdownText += "\n\n---\n\n> ⚠️ *文档体积较大（超过 2MB），Quick Look 仅展示前 2MB 内容。完整编辑与查阅请在 Inkpoint 中打开。*"
        }

        // Render Markdown to static standalone HTML using shared renderer engine
        let finalHTML = Self.engine.renderDocument(markdown: markdownText, title: filename)

        // Write HTML to temporary preview directory
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("inkpoint-ql-\(ProcessInfo.processInfo.globallyUniqueString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let htmlFileURL = tempDir.appendingPathComponent("preview.html")
        try finalHTML.write(to: htmlFileURL, atomically: true, encoding: .utf8)

        let reply = QLPreviewReply(fileURL: htmlFileURL)
        reply.title = filename
        return reply
    }
}

/// Host runner for bundled quicklook-engine.js in JavaScriptCore
final class QuickLookEngine {
    private let context: JSContext?
    private let lock = NSLock()

    init() {
        guard let ctx = JSContext() else {
            self.context = nil
            return
        }

        // Exception handling for debugging in macOS Console / system log
        ctx.exceptionHandler = { _, exception in
            if let exc = exception {
                NSLog("[InkpointQuickLook] JavaScriptCore Exception: \(exc.toString() ?? "unknown error")")
            }
        }

        // Global polyfills for headless environment
        ctx.evaluateScript("""
        var global = this; var window = this; var globalThis = this;
        if (typeof console === 'undefined') {
            var console = { log: function() {}, warn: function() {}, error: function() {} };
        }
        """)

        let bundle = Bundle(for: QuickLookEngine.self)

        // Load bundled quicklook-engine.js
        if let script = Self.loadScript(named: "quicklook-engine", bundle: bundle) {
            ctx.evaluateScript(script)
        } else {
            NSLog("[InkpointQuickLook] Warning: quicklook-engine.js could not be loaded from bundle")
        }

        self.context = ctx
    }

    func renderDocument(markdown: String, title: String) -> String {
        lock.lock()
        defer { lock.unlock() }

        guard let ctx = context else {
            return fallbackHTML(markdown: markdown, title: title)
        }

        // Call InkpointStaticRenderer.renderStaticDocument(markdown, { title })
        let rendererObj = ctx.objectForKeyedSubscript("InkpointStaticRenderer")
        if let renderFunc = rendererObj?.objectForKeyedSubscript("renderStaticDocument") {
            let options: [String: Any] = ["title": title]
            let result = renderFunc.call(withArguments: [markdown, options])
            if let html = result?.toString(), !html.isEmpty, html != "undefined", html != "null" {
                return html
            }
        }

        return fallbackHTML(markdown: markdown, title: title)
    }

    private func fallbackHTML(markdown: String, title: String) -> String {
        let escapedTitle = title.replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        let escapedContent = markdown.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        return """
        <!doctype html>
        <html>
        <head><meta charset="utf-8"><title>\(escapedTitle)</title></head>
        <body style="font-family: -apple-system, sans-serif; padding: 32px; background: #1e1e1e; color: #f5f5f7;">
        <h1>\(escapedTitle)</h1>
        <pre style="white-space: pre-wrap; word-wrap: break-word;"><code>\(escapedContent)</code></pre>
        </body>
        </html>
        """
    }

    private static func loadScript(named name: String, bundle: Bundle) -> String? {
        if let url = bundle.url(forResource: name, withExtension: "js") {
            if let str = try? String(contentsOf: url, encoding: .utf8) { return str }
        }
        if let resURL = bundle.resourceURL {
            let fileURL = resURL.appendingPathComponent("\(name).js")
            if let str = try? String(contentsOf: fileURL, encoding: .utf8) { return str }
        }
        if let url = Bundle.main.url(forResource: name, withExtension: "js") {
            if let str = try? String(contentsOf: url, encoding: .utf8) { return str }
        }
        return nil
    }
}
