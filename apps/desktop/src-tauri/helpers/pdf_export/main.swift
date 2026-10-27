import Foundation
import WebKit
import PDFKit

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: inkpoint-pdf-exporter <input_html_path> <output_pdf_path> [pageSize] [orientation]\n", stderr)
    exit(2)
}

let inputPath = CommandLine.arguments[1]
let outputPath = URL(fileURLWithPath: CommandLine.arguments[2])
let pageSizeArg = CommandLine.arguments.count >= 4 ? CommandLine.arguments[3].uppercased() : "A4"
let orientationArg = CommandLine.arguments.count >= 5 ? CommandLine.arguments[4].lowercased() : "portrait"

guard let htmlContent = try? String(contentsOfFile: inputPath, encoding: .utf8) else {
    fputs("Error: Failed to read HTML file from \(inputPath)\n", stderr)
    exit(3)
}

// 标准打印纸张尺寸（单位：PostScript Points，72 pt = 1 inch）
var rawWidth: CGFloat = 595.28 // A4 默认宽度 (210mm)
var rawHeight: CGFloat = 841.89 // A4 默认高度 (297mm)

if pageSizeArg == "LETTER" {
    rawWidth = 612.0
    rawHeight = 792.0
}

let pageWidth: CGFloat = orientationArg == "landscape" ? rawHeight : rawWidth
let pageHeight: CGFloat = orientationArg == "landscape" ? rawWidth : rawHeight

class PDFExportRunner: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    let outputPath: URL
    let pageWidth: CGFloat
    let pageHeight: CGFloat

    init(outputPath: URL, pageWidth: CGFloat, pageHeight: CGFloat) {
        self.outputPath = outputPath
        self.pageWidth = pageWidth
        self.pageHeight = pageHeight

        let config = WKWebViewConfiguration()
        self.webView = WKWebView(
            frame: CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight),
            configuration: config
        )
        super.init()
        self.webView.navigationDelegate = self
    }

    func start(html: String) {
        // 设置 15 秒兜底超时保护，避免进程因未知异常常驻
        Timer.scheduledTimer(withTimeInterval: 15.0, repeats: false) { _ in
            fputs("Error: PDF export timed out after 15 seconds\n", stderr)
            exit(124)
        }

        self.webView.loadHTMLString(html, baseURL: URL(string: "https://localhost/"))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 等待字体就绪与排版渲染完成（字体加载、KaTeX 布局、Mermaid 尺寸计算）
        let js = """
        (async () => {
            if (document.fonts && document.fonts.ready) {
                try {
                    await document.fonts.ready;
                } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 200));
            return Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0);
        })()
        """
        self.webView.evaluateJavaScript(js) { [weak self] result, error in
            guard let self = self else { return }
            let totalHeight = (result as? NSNumber)?.doubleValue ?? Double(self.pageHeight)
            let numPages = max(1, Int(ceil(totalHeight / Double(self.pageHeight))))
            self.capturePages(numPages: numPages)
        }
    }

    func capturePages(numPages: Int) {
        let finalDoc = PDFDocument()
        var currentPage = 0

        func captureNext() {
            if currentPage >= numPages {
                if finalDoc.pageCount == 0 {
                    fputs("Error: No PDF pages generated\n", stderr)
                    exit(4)
                }
                let success = finalDoc.write(to: self.outputPath)
                if success {
                    exit(0)
                } else {
                    fputs("Error: Failed to write PDF document to \(self.outputPath.path)\n", stderr)
                    exit(5)
                }
            }

            let yOffset = CGFloat(currentPage) * self.pageHeight
            let config = WKPDFConfiguration()
            config.rect = CGRect(x: 0, y: yOffset, width: self.pageWidth, height: self.pageHeight)

            self.webView.createPDF(configuration: config) { [weak self] result in
                guard self != nil else { return }
                switch result {
                case .success(let data):
                    if let doc = PDFDocument(data: data), let page = doc.page(at: 0) {
                        finalDoc.insert(page, at: finalDoc.pageCount)
                    }
                    currentPage += 1
                    captureNext()
                case .failure(let err):
                    fputs("Error creating PDF page \(currentPage): \(err.localizedDescription)\n", stderr)
                    exit(6)
                }
            }
        }

        captureNext()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("Error loading HTML in webView: \(error.localizedDescription)\n", stderr)
        exit(7)
    }
}

let runner = PDFExportRunner(outputPath: outputPath, pageWidth: pageWidth, pageHeight: pageHeight)
runner.start(html: htmlContent)

RunLoop.main.run()
