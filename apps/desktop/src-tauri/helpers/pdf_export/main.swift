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

struct AnchorInfo {
    let hash: String
    let x: CGFloat
    let y: CGFloat
    let w: CGFloat
    let h: CGFloat
    let targetY: CGFloat
}

struct HeadingInfo {
    let title: String
    let level: Int
    let targetY: CGFloat
}

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
        // 等待字体就绪与排版渲染完成（字体加载、KaTeX 布局、Mermaid 尺寸计算），并提取锚点与标题大纲数据
        let js = """
        if (document.fonts && document.fonts.ready) {
            try {
                await document.fonts.ready;
            } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 200));

        // 1. 收集文档内部锚点链接及其目标元素坐标
        const anchors = [];
        const links = document.querySelectorAll('a[href^="#"]');
        for (const a of links) {
            const rawHref = a.getAttribute('href') || '';
            let hash = rawHref.slice(1);
            if (!hash) continue;
            try {
                hash = decodeURIComponent(hash);
            } catch (e) {}

            let target = document.getElementById(hash);
            if (!target) {
                try {
                    target = document.querySelector(`[id="${CSS.escape(hash)}"]`) ||
                             document.querySelector(`[name="${CSS.escape(hash)}"]`);
                } catch (e) {}
            }

            if (!target) continue;

            const rect = a.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;

            const tRect = target.getBoundingClientRect();
            const aX = rect.left + window.scrollX;
            const aY = rect.top + window.scrollY;
            const targetY = tRect.top + window.scrollY;

            anchors.push({
                hash: hash,
                x: aX,
                y: aY,
                w: rect.width,
                h: rect.height,
                targetY: targetY
            });
        }

        // 2. 收集各级标题用于构建 PDF 书签大纲 (PDFOutline)
        const headings = [];
        const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (const h of headingEls) {
            const text = (h.textContent || '').trim();
            if (!text) continue;
            const level = parseInt(h.tagName.substring(1), 10) || 1;
            const hRect = h.getBoundingClientRect();
            const targetY = hRect.top + window.scrollY;
            headings.push({
                title: text,
                level: level,
                targetY: targetY
            });
        }

        const totalHeight = Math.max(
            document.documentElement.scrollHeight || 0,
            document.body.scrollHeight || 0
        );

        return {
            totalHeight: totalHeight,
            anchors: anchors,
            headings: headings
        };
        """
        self.webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { [weak self] res in
            guard let self = self else { return }
            var result: Any? = nil
            switch res {
            case .success(let val):
                result = val
            case .failure(let error):
                fputs("Warning: JavaScript execution error: \(error.localizedDescription)\n", stderr)
            }

            var totalHeight = Double(self.pageHeight)
            var parsedAnchors: [AnchorInfo] = []
            var parsedHeadings: [HeadingInfo] = []

            if let dict = result as? [String: Any] {
                if let th = (dict["totalHeight"] as? NSNumber)?.doubleValue {
                    totalHeight = th
                }
                if let rawAnchors = dict["anchors"] as? [[String: Any]] {
                    for item in rawAnchors {
                        guard let hash = item["hash"] as? String,
                              let x = (item["x"] as? NSNumber)?.doubleValue,
                              let y = (item["y"] as? NSNumber)?.doubleValue,
                              let w = (item["w"] as? NSNumber)?.doubleValue,
                              let h = (item["h"] as? NSNumber)?.doubleValue,
                              let targetY = (item["targetY"] as? NSNumber)?.doubleValue else { continue }
                        parsedAnchors.append(AnchorInfo(
                            hash: hash,
                            x: CGFloat(x),
                            y: CGFloat(y),
                            w: CGFloat(w),
                            h: CGFloat(h),
                            targetY: CGFloat(targetY)
                        ))
                    }
                }
                if let rawHeadings = dict["headings"] as? [[String: Any]] {
                    for item in rawHeadings {
                        guard let title = item["title"] as? String,
                              let level = (item["level"] as? NSNumber)?.intValue,
                              let targetY = (item["targetY"] as? NSNumber)?.doubleValue else { continue }
                        parsedHeadings.append(HeadingInfo(
                            title: title,
                            level: level,
                            targetY: CGFloat(targetY)
                        ))
                    }
                }
            }

            let numPages = max(1, Int(ceil(totalHeight / Double(self.pageHeight))))
            self.capturePages(numPages: numPages, anchors: parsedAnchors, headings: parsedHeadings)
        }
    }

    func capturePages(numPages: Int, anchors: [AnchorInfo], headings: [HeadingInfo]) {
        let finalDoc = PDFDocument()
        var currentPage = 0

        func captureNext() {
            if currentPage >= numPages {
                if finalDoc.pageCount == 0 {
                    fputs("Error: No PDF pages generated\n", stderr)
                    exit(4)
                }

                // 1. 将页面内部锚点链接与目标页 destination 进行关联绑定
                self.linkInternalAnchors(in: finalDoc, anchors: anchors)

                // 2. 为 PDF 文档添加大纲目录（书签导航树）
                self.buildDocumentOutline(in: finalDoc, headings: headings)

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

    private func linkInternalAnchors(in doc: PDFDocument, anchors: [AnchorInfo]) {
        for a in anchors {
            let srcPageIndex = Int(floor(a.y / self.pageHeight))
            let tgtPageIndex = Int(floor(a.targetY / self.pageHeight))

            guard srcPageIndex < doc.pageCount, tgtPageIndex < doc.pageCount else { continue }
            guard let srcPage = doc.page(at: srcPageIndex),
                  let tgtPage = doc.page(at: tgtPageIndex) else { continue }

            // 计算目标在目标页中的 PDF 坐标（PDF 坐标系原点在左下角，y 从下往上增加）
            let tgtPageLocalY = a.targetY - CGFloat(tgtPageIndex) * self.pageHeight
            let tgtPdfY = max(0, self.pageHeight - tgtPageLocalY + 16)
            let destination = PDFDestination(page: tgtPage, at: CGPoint(x: 0, y: tgtPdfY))

            // 计算链接在源页中的 PDF 坐标 Bounds
            let srcPageLocalY = a.y - CGFloat(srcPageIndex) * self.pageHeight
            let srcPdfY = self.pageHeight - srcPageLocalY - a.h
            let expectedBounds = CGRect(x: a.x, y: srcPdfY, width: a.w, height: a.h)

            // 优先查找 WebKit 已生成的 Link 注解并覆写其 destination
            var matched: PDFAnnotation? = nil
            for ann in srcPage.annotations where ann.type == "Link" {
                if let urlStr = ann.url?.absoluteString, urlStr.contains("#\(a.hash)") {
                    matched = ann
                    break
                }
                if ann.url == nil && ann.destination == nil {
                    if ann.bounds.insetBy(dx: -4, dy: -4).intersects(expectedBounds) {
                        matched = ann
                        break
                    }
                }
            }

            if let ann = matched {
                ann.url = nil
                ann.destination = destination
            } else {
                let newAnn = PDFAnnotation(bounds: expectedBounds, forType: .link, withProperties: nil)
                newAnn.destination = destination
                srcPage.addAnnotation(newAnn)
            }
        }
    }

    private func buildDocumentOutline(in doc: PDFDocument, headings: [HeadingInfo]) {
        guard !headings.isEmpty, doc.pageCount > 0 else { return }

        let rootOutline = PDFOutline()
        var stack: [(level: Int, outline: PDFOutline)] = []

        for h in headings {
            let tgtPageIndex = min(doc.pageCount - 1, max(0, Int(floor(h.targetY / self.pageHeight))))
            guard let tgtPage = doc.page(at: tgtPageIndex) else { continue }

            let tgtPageLocalY = h.targetY - CGFloat(tgtPageIndex) * self.pageHeight
            let tgtPdfY = max(0, self.pageHeight - tgtPageLocalY + 16)
            let destination = PDFDestination(page: tgtPage, at: CGPoint(x: 0, y: tgtPdfY))

            let outline = PDFOutline()
            outline.label = h.title
            outline.destination = destination

            while let last = stack.last, last.level >= h.level {
                stack.removeLast()
            }

            let parent = stack.last?.outline ?? rootOutline
            parent.insertChild(outline, at: parent.numberOfChildren)
            stack.append((level: h.level, outline: outline))
        }

        doc.outlineRoot = rootOutline
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fputs("Error loading HTML in webView: \(error.localizedDescription)\n", stderr)
        exit(7)
    }
}

let runner = PDFExportRunner(outputPath: outputPath, pageWidth: pageWidth, pageHeight: pageHeight)
runner.start(html: htmlContent)

RunLoop.main.run()
