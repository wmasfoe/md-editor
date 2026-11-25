import Foundation
import QuickLookUI
import UniformTypeIdentifiers

/// Inkpoint Quick Look Preview Provider
///
/// 渲染委托给 Rust 静态库 `md-render-ffi`（见仓库 `crates/render-ffi`）。
///
/// 历史：本扩展曾内嵌 1.3 MB 的 `quicklook-engine.js` 并用 JavaScriptCore 执行。
/// 迁到 Rust 的原因是双实现收敛——桌面导出与 Finder 预览现在共用同一套渲染核心，
/// 由 `scripts/render-diff` 的差分测试守护等价性。
///
/// 为什么不继续用 JSC：本扩展的 entitlements 只有 app-sandbox 与只读文件访问，
/// **没有** `com.apple.security.cs.allow-jit`，因此 WebAssembly 不可用。
/// Rust 原生机器码通过 C ABI 调用不受此限制（内部 QuickJS 是纯解释器，无需 JIT）。
@objc(PreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {

    private static let maxPreviewBytes = 2 * 1024 * 1024 // 2MB safety threshold

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

        // Render Markdown to standalone HTML using the shared Rust renderer
        let finalHTML = RustRenderer.renderDocument(markdown: markdownText, title: filename)

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

/// Rust 渲染核心的 C ABI 绑定。
///
/// 符号来自 `crates/render-ffi`，静态链接进本扩展。
enum RustRenderer {

    /// 渲染完整 standalone 文档。
    ///
    /// 失败（返回 `NULL`）时回退为纯文本预览，保证 Finder 里始终有内容可看，
    /// 而不是一片空白。
    static func renderDocument(markdown: String, title: String) -> String {
        let html = markdown.withCString { markdownPointer in
            title.withCString { titlePointer in
                md_render_document(markdownPointer, titlePointer, nil)
            }
        }

        guard let html else {
            return fallbackHTML(markdown: markdown, title: title)
        }
        defer { md_render_free_string(html) }
        return String(cString: html)
    }

    /// 内嵌 KaTeX 版本，用于启动自检日志。
    static var katexVersion: String {
        guard let pointer = md_render_katex_version() else { return "unknown" }
        return String(cString: pointer)
    }

    private static func fallbackHTML(markdown: String, title: String) -> String {
        let escapedTitle = title
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let escapedContent = markdown
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
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
}

// MARK: - C ABI 声明（来自 crates/render-ffi）

/// 渲染 Markdown 为完整 standalone HTML 文档。
///
/// - Parameters:
///   - markdown: NUL 结尾的 UTF-8 Markdown 源码
///   - title: NUL 结尾的标题；传 `nil` 时从正文提取
///   - customCSS: NUL 结尾的追加 CSS；可为 `nil`
/// - Returns: 新分配的 C 字符串，**必须**用 `md_render_free_string` 释放
@_silgen_name("md_render_document")
private func md_render_document(
    _ markdown: UnsafePointer<CChar>?,
    _ title: UnsafePointer<CChar>?,
    _ customCSS: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>?

/// 渲染 Markdown 为 HTML 片段。
@_silgen_name("md_render_fragment")
private func md_render_fragment(_ markdown: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?

/// 释放本库返回的字符串。
@_silgen_name("md_render_free_string")
private func md_render_free_string(_ pointer: UnsafeMutablePointer<CChar>?)

/// 内嵌 KaTeX 版本号（静态字符串，不需要释放）。
@_silgen_name("md_render_katex_version")
private func md_render_katex_version() -> UnsafePointer<CChar>?
