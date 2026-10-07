import SwiftUI
import Combine

/// Inkpoint 移动端核心文档视图
public struct DocumentView: View {
    @StateObject public var documentModel: DocumentModel
    private let bridgeController: InkpointBridgeController

    @State private var showOutlineSheet: Bool = false
    @State private var showDocumentPicker: Bool = false
    @State private var showInfoSheet: Bool = false
    /// 诊断日志页（上次运行异常结束时自动弹出）
    @State private var showDiagnostics: Bool = false

    /// 前后台状态：进入后台时写「正常退出」标记，用于区分「崩溃」与「正常退出」
    @Environment(\.scenePhase) private var scenePhase

    /// 系统外观：暗色模式下需要同步告知 web 内容（原生 chrome 会自动跟随）
    @Environment(\.colorScheme) private var colorScheme

    /// 诊断实验开关（A/B 定位用，持久化）：开启后不再把键盘工具栏挂到键盘上。
    /// 与 DiagnosticsView 里的开关共用同一个键；崩溃重启后仍生效。
    @AppStorage("inkpoint.diag.noKeyboardToolbar") private var diagNoKeyboardToolbar: Bool = false

    public init(documentModel: DocumentModel? = nil) {
        let model = documentModel ?? DocumentModel()
        _documentModel = StateObject(wrappedValue: model)
        self.bridgeController = InkpointBridgeController(documentModel: model)
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                // 离线 CodeMirror 6 Webview 容器
                EditorWebView(documentModel: documentModel, bridgeController: bridgeController)
                    .ignoresSafeArea(.keyboard, edges: .bottom)
            }
            .navigationTitle(documentModel.title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            // 诊断：上次异常结束则自动弹出日志；进入后台记一次「正常退出」；
            // 键盘显示/隐藏也各记一笔（iOS 键盘相关的崩溃靠它定位）
            .onAppear {
                if LaunchDiagnostics.previousSessionCrashed {
                    showDiagnostics = true
                }
                syncAppearance()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background {
                    LaunchDiagnostics.markCleanExit()
                }
            }
            // 系统外观变化时同步给 web（避免「深色外壳 + 浅色正文」的对比度错乱）
            .onChange(of: colorScheme) { _, _ in
                syncAppearance()
            }
            // web 就绪后补发一次：启动阶段 web 尚未加载，首次指令会落空
            .onChange(of: documentModel.isWebViewReady) { _, ready in
                if ready {
                    syncAppearance()
                }
            }
            #if canImport(UIKit)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                LaunchDiagnostics.mark("keyboard: 将要显示")
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                LaunchDiagnostics.mark("keyboard: 已显示")
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                LaunchDiagnostics.mark("keyboard: 将要隐藏")
            }
            #endif
            .toolbar {
                // 导航栏左侧：打开文件与文档修改标记
                #if os(iOS)
                ToolbarItem(placement: .topBarLeading) {
                    leadingToolbarContent
                }
                #else
                ToolbarItem(placement: .navigation) {
                    leadingToolbarContent
                }
                #endif

                // 导航栏右侧：大纲导航、双态切换与更多选项
                #if os(iOS)
                ToolbarItemGroup(placement: .topBarTrailing) {
                    trailingToolbarContent
                }
                #else
                ToolbarItemGroup(placement: .primaryAction) {
                    trailingToolbarContent
                }
                #endif

                // 键盘附加上方悬浮快捷工具栏 (仅在编辑态激活)
                #if canImport(UIKit)
                if documentModel.mode == .edit && !diagNoKeyboardToolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        KeyboardAccessoryBar(documentModel: documentModel)
                    }
                }
                #endif
            }
            // 大纲抽屉 Sheet
            .sheet(isPresented: $showOutlineSheet) {
                OutlineView(documentModel: documentModel)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            // 文件选择器
            #if canImport(UIKit)
            .sheet(isPresented: $showDocumentPicker) {
                DocumentPicker { pickedURL in
                    documentModel.loadFromFile(url: pickedURL)
                }
            }
            #endif
            // 诊断日志页（可手动打开；上次异常结束时也会自动弹出）
            .sheet(isPresented: $showDiagnostics) {
                DiagnosticsView()
            }
        }
    }

    // MARK: - Appearance

    /// 把当前系统外观同步给 web 内容
    private func syncAppearance() {
        documentModel.setTheme(isDark: colorScheme == .dark)
    }

    // MARK: - Toolbar Subviews

    @ViewBuilder
    private var leadingToolbarContent: some View {
        HStack(spacing: 6) {
            Button {
                showDocumentPicker = true
            } label: {
                Image(systemName: "folder")
                    .font(.system(size: 15, weight: .medium))
            }

            if documentModel.isDirty {
                Circle()
                    .fill(Color.orange)
                    .frame(width: 7, height: 7)
            }
        }
    }

    @ViewBuilder
    private var trailingToolbarContent: some View {
        // 大纲抽屉按钮
        Button {
            #if canImport(UIKit)
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            #endif
            showOutlineSheet = true
        } label: {
            Image(systemName: "list.bullet.indent")
                .font(.system(size: 15, weight: .medium))
        }

        // 只读 / 编辑 模式切换按钮 (带弹性微动效)
        Button {
            #if canImport(UIKit)
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
            #endif
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                documentModel.toggleMode()
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: documentModel.mode == .read ? "pencil" : "eye")
                    .font(.system(size: 14, weight: .semibold))
                Text(documentModel.mode == .read ? "编辑" : "阅读")
                    .font(.system(size: 14, weight: .medium))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(documentModel.mode == .edit ? Color.accentColor.opacity(0.15) : Color.clear)
            .clipShape(Capsule())
        }

        // 更多菜单 (统计、保存与新建)
        Menu {
            Section("文档操作") {
                Button {
                    documentModel.requestSave()
                } label: {
                    Label("立即保存", systemImage: "square.and.arrow.down")
                }

                Button {
                    documentModel.loadSampleDocument()
                } label: {
                    Label("新建示例文件", systemImage: "doc.badge.plus")
                }
            }

            Section("文档信息") {
                Text("字数统计: \(documentModel.wordCount) 字")
                Text("阅读时长: ~\(max(1, documentModel.wordCount / 300)) 分钟")
            }

            Section("诊断") {
                Button {
                    showDiagnostics = true
                } label: {
                    Label("诊断日志", systemImage: "doc.text.magnifyingglass")
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 15, weight: .medium))
        }
    }
}

