import SwiftUI
#if canImport(InkpointCore)
import InkpointCore
#endif

@main
struct InkpointApp: App {
    @StateObject private var documentModel = DocumentModel()

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
