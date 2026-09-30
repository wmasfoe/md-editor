import SwiftUI
#if canImport(InkpointCore)
import InkpointCore
#endif

@main
struct InkpointApp: App {
    @StateObject private var documentModel = DocumentModel()

    init() {
        // 启动诊断：装未捕获异常处理器（KVC 私有 key 之类的 ObjC 异常会被记录下来），
        // 便于在没有 Xcode/Console 的环境下定位「启动即闪退」。日志见沙盒 Documents/inkpoint-launch.log。
        LaunchDiagnostics.installCrashHandler()
        LaunchDiagnostics.mark("app: InkpointApp.init 完成")
    }

    var body: some Scene {
        WindowGroup {
            DocumentView(documentModel: documentModel)
                .onOpenURL { incomingURL in
                    // 处理系统 Files / 隔空投送 / 微信等外部应用“用 Inkpoint 打开”
                    documentModel.loadFromFile(url: incomingURL)
                }
        }
    }
}
