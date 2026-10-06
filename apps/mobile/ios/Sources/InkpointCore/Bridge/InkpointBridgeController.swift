import Foundation
#if canImport(WebKit)
import WebKit
#endif
#if canImport(UIKit)
import UIKit
#endif

/// WKWebView 与原生 SwiftUI 状态机之间的双向桥接控制器
public final class InkpointBridgeController: NSObject {
    public weak var documentModel: DocumentModel?
    #if canImport(WebKit)
    public weak var webView: WKWebView?
    #endif

    public init(documentModel: DocumentModel? = nil) {
        self.documentModel = documentModel
        super.init()
    }

    // MARK: - Native to Web (evaluateJavaScript)

    /// 向 WebView 发送 NativeActionMessage
    public func dispatchAction(_ action: NativeActionMessage) {
        #if canImport(WebKit)
        LaunchDiagnostics.mark("bridge: 派发 \(action.action)")
        guard let webView = self.webView else {
            LaunchDiagnostics.mark("bridge: WebView 为空，\(action.action) 未派发")
            print("[InkpointBridgeController] Cannot dispatch action: webView is nil")
            return
        }
        if action.action == "setMode" {
            LaunchDiagnostics.markMemory("edit: 派发 setMode 前")
            startMemorySampling()
            // 冒烟测试：先跑一条结果确定可序列化的脚本，
            // 用于区分「evaluateJavaScript 通道本身崩溃」与「具体脚本内容崩溃」。
            LaunchDiagnostics.mark("诊断: 冒烟 eval 开始")
            webView.evaluateJavaScript("1 + 1") { result, error in
                if let error = error {
                    LaunchDiagnostics.mark("诊断: 冒烟 eval 失败 \(error.localizedDescription)")
                } else {
                    LaunchDiagnostics.mark("诊断: 冒烟 eval 成功 -> \(String(describing: result))")
                }
            }
        }

        guard let jsonString = action.toJSONString() else {
            print("[InkpointBridgeController] Failed to serialize action:", action.action)
            return
        }

        // 将 JSON 转换为安全字符串参数嵌入 JS 调用
        let escaped = jsonString
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")

        // 关键：脚本必须**返回可序列化的值**。
        // `evaluateJavaScript` 拿到 `undefined` 结果时会走 WebKit 的「unsupported type」处理路径，
        // 在部分系统版本上该路径直接断言崩溃（SIGTRAP，调用栈落在 WebKit/JavaScriptCore 内，
        // 与实测日志一致）。这里用 IIFE 显式返回字符串："ok"=已派发、"missing"=页面里还没有桥。
        let js = "(function() { if (window.InkpointBridge) { window.InkpointBridge.dispatchNativeAction(\"\(escaped)\"); return \"ok\"; } return \"missing\"; })()"

        Task { @MainActor in
            let actionName = action.action
            LaunchDiagnostics.mark("bridge: \(actionName) 的 JS 开始执行")
            // 用 completion-handler 版 API 而不是 `try await` 版：
            // 后者走 Swift 并发覆盖层（libswiftWebKit），该覆盖层有已知崩溃报告，尽量绕开。
            webView.evaluateJavaScript(js) { result, error in
                if let error = error {
                    LaunchDiagnostics.mark("bridge: \(actionName) 的 JS 执行失败 \(error.localizedDescription)")
                    print("[InkpointBridgeController] JS eval error for action \(actionName):", error)
                } else {
                    LaunchDiagnostics.mark("bridge: \(actionName) 的 JS 已执行 -> \(String(describing: result))")
                    LaunchDiagnostics.markMemory("bridge: \(actionName) JS 完成后")
                }
            }
        }
        #endif
    }

    // MARK: - Web to Native (WKScriptMessageHandler)

    public func handleIncomingMessage(body: Any) {
        let jsonString: String?
        if let str = body as? String {
            jsonString = str
        } else if let dict = body as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: dict),
                  let str = String(data: data, encoding: .utf8) {
            jsonString = str
        } else {
            jsonString = nil
        }

        guard let rawJson = jsonString,
              let data = rawJson.data(using: .utf8) else {
            print("[InkpointBridgeController] Invalid incoming message body:", body)
            return
        }

        do {
            let eventMsg = try JSONDecoder().decode(WebEventMessage.self, from: data)
            Task { @MainActor in
                self.processEvent(eventMsg)
            }
        } catch {
            print("[InkpointBridgeController] Failed to decode WebEventMessage:", error)
        }
    }

    /// setMode 之后连续采样内存 10 秒（每秒 1 次）。
    /// 若崩溃与内存增长相关（被系统直接杀掉不会留下任何崩溃标记），采样值就是唯一线索；
    /// 采样条数也顺带记录了 App 在 setMode 后存活了多久。
    private func startMemorySampling() {
        Task { @MainActor in
            for index in 1...10 {
                try? await Task.sleep(for: .seconds(1))
                LaunchDiagnostics.markMemory("edit: 采样 #\(index)")
            }
        }
    }

    @MainActor
    private func processEvent(_ event: WebEventMessage) {
        LaunchDiagnostics.mark("bridge: 收到事件 \(event.event)")
        switch event.event {
        case "ready", "onDocumentReady":
            documentModel?.notifyWebViewReady()

        case "contentChange", "onContentChange":
            let isDirty = event.payload["isDirty"]?.boolValue ?? false
            let wordCount = event.payload["wordCount"]?.intValue ?? 0
            documentModel?.handleContentChange(isDirty: isDirty, wordCount: wordCount)

        case "saveResponse", "onSaveContentResponse":
            let markdown = (event.payload["markdown"] ?? event.payload["content"])?.stringValue ?? ""
            let isSuccess = (event.payload["isSuccess"] ?? event.payload["success"])?.boolValue ?? false
            documentModel?.handleSaveResponse(markdown: markdown, isSuccess: isSuccess)

        case "haptic", "triggerHaptic":
            if let typeStr = (event.payload["type"] ?? event.payload["style"])?.stringValue,
               let hapticType = HapticFeedbackType(rawValue: typeStr) {
                triggerHaptic(hapticType)
            }

        case "outlineExtracted", "onOutlineExtracted":
            let rawItems = event.payload["headings"] ?? event.payload["outline"]
            if let items = rawItems,
               case .array(let arr) = items {
                let parsed: [OutlineHeading] = arr.compactMap { item in
                    guard case .dictionary(let dict) = item,
                          let id = (dict["headingId"] ?? dict["id"])?.stringValue,
                          let text = dict["text"]?.stringValue,
                          let level = dict["level"]?.intValue else {
                        return nil
                    }
                    return OutlineHeading(headingId: id, text: text, level: level)
                }
                documentModel?.handleOutlineExtracted(headings: parsed)
            }

        case "openUrl":
            if let urlString = event.payload["url"]?.stringValue,
               let url = URL(string: urlString) {
                #if canImport(UIKit)
                UIApplication.shared.open(url)
                #endif
            }

        default:
            print("[InkpointBridgeController] Unhandled event:", event.event)
        }
    }

    // MARK: - Haptic Generator

    private func triggerHaptic(_ type: HapticFeedbackType) {
        #if canImport(UIKit)
        Task { @MainActor in
            switch type {
            case .impactLight:
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
            case .impactMedium:
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
            case .impactHeavy:
                let generator = UIImpactFeedbackGenerator(style: .heavy)
                generator.impactOccurred()
            case .selection:
                let generator = UISelectionFeedbackGenerator()
                generator.selectionChanged()
            case .notificationSuccess:
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.success)
            case .notificationError:
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.error)
            }
        }
        #endif
    }
}

#if canImport(WebKit)
extension InkpointBridgeController: WKScriptMessageHandler {
    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "InkpointBridge" else { return }
        handleIncomingMessage(body: message.body)
    }
}
#endif
