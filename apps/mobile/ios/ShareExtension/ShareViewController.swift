import UIKit
import Social
import UniformTypeIdentifiers

/// iOS 系统级分享扩展 (Share Extension)
/// 支持在“文件 App / 微信 / Safari”中点击“用 Inkpoint 打开”直接导入文档
class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let spinner = UIActivityIndicatorView(style: .large)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])

        handleIncomingShareItem()
    }

    private func handleIncomingShareItem() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = item.attachments,
              let provider = attachments.first else {
            completeExtension()
            return
        }

        // 1. 处理传入的文件 URL (例如来自“文件”App 或“微信”其他应用打开)
        if provider.hasItemConformingToTypeIdentifier(UTType.item.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.item.identifier, options: nil) { [weak self] (item, error) in
                guard let self = self else { return }

                if let fileURL = item as? URL {
                    self.openInMainApp(fileURL: fileURL)
                } else {
                    self.completeExtension()
                }
            }
            return
        }

        // 2. 处理纯文本输入 (例如从 Safari 或备忘录选中的 Markdown 文本)
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] (item, error) in
                guard let self = self else { return }

                if let text = item as? String {
                    self.saveTextAndOpen(text: text)
                } else {
                    self.completeExtension()
                }
            }
            return
        }

        completeExtension()
    }

    private func openInMainApp(fileURL: URL) {
        // 构建深度链接 inkpoint://open?path=...
        let encodedPath = fileURL.path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if let appURL = URL(string: "inkpoint://open?path=\(encodedPath)") {
            openURL(appURL)
        }
        completeExtension()
    }

    private func saveTextAndOpen(text: String) {
        // 将文本写入 App Group 共享目录
        if let sharedContainer = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.inkpoint.editor") {
            let tempFile = sharedContainer.appendingPathComponent("shared_import_\(Date().timeIntervalSince1970).md")
            try? text.write(to: tempFile, atomically: true, encoding: .utf8)
            if let appURL = URL(string: "inkpoint://import?path=\(tempFile.path)") {
                openURL(appURL)
            }
        }
        completeExtension()
    }

    private func openURL(_ url: URL) {
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(url)
                break
            }
            responder = responder?.next
        }
    }

    private func completeExtension() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }
}
