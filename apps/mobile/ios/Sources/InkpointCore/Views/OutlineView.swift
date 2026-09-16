import SwiftUI

/// 文档大纲抽屉视图 (TOC Sheet)
public struct OutlineView: View {
    @ObservedObject public var documentModel: DocumentModel
    @Environment(\.dismiss) private var dismiss

    public init(documentModel: DocumentModel) {
        self.documentModel = documentModel
    }

    public var body: some View {
        NavigationStack {
            Group {
                if documentModel.headings.isEmpty {
                    ContentUnavailableView(
                        "暂无大纲信息",
                        systemImage: "list.bullet.indent",
                        description: Text("在文档中添加 # 标题即可自动生成大纲导航。")
                    )
                } else {
                    List {
                        ForEach(documentModel.headings) { heading in
                            Button {
                                #if canImport(UIKit)
                                let generator = UISelectionFeedbackGenerator()
                                generator.selectionChanged()
                                #endif
                                documentModel.scrollToHeading(heading.headingId)
                                dismiss()
                            } label: {
                                HStack(spacing: 8) {
                                    // 根据标题级别做视觉层级缩进
                                    let indent = CGFloat(max(0, heading.level - 1)) * 14
                                    Spacer().frame(width: indent)

                                    Circle()
                                        .fill(levelColor(heading.level))
                                        .frame(width: 6, height: 6)

                                    Text(heading.text)
                                        .font(.system(
                                            size: fontSize(heading.level),
                                            weight: fontWeight(heading.level)
                                        ))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)

                                    Spacer()

                                    Text("H\(heading.level)")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                                .padding(.vertical, 4)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    #if os(iOS)
                    .listStyle(.insetGrouped)
                    #else
                    .listStyle(.sidebar)
                    #endif
                }
            }
            .navigationTitle("文档大纲")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func levelColor(_ level: Int) -> Color {
        switch level {
        case 1: return .accentColor
        case 2: return .blue
        case 3: return .teal
        default: return .secondary
        }
    }

    private func fontSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: return 16
        case 2: return 15
        default: return 14
        }
    }

    private func fontWeight(_ level: Int) -> Font.Weight {
        switch level {
        case 1: return .semibold
        case 2: return .medium
        default: return .regular
        }
    }
}
