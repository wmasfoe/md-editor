import SwiftUI

/// Inkpoint 移动端核心文档视图
public struct DocumentView: View {
    @StateObject public var documentModel: DocumentModel
    private let bridgeController: InkpointBridgeController

    @State private var showOutlineSheet: Bool = false
    @State private var showDocumentPicker: Bool = false
    @State private var showInfoSheet: Bool = false

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
                if documentModel.mode == .edit {
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
        }
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
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 15, weight: .medium))
        }
    }
}

