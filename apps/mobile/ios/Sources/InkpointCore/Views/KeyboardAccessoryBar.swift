import SwiftUI

/// 移动端专属弹簧手感 Markdown 快捷格式化键盘工具栏
public struct KeyboardAccessoryBar: View {
    @ObservedObject public var documentModel: DocumentModel
    public var onDismissKeyboard: (() -> Void)?

    public init(documentModel: DocumentModel, onDismissKeyboard: (() -> Void)? = nil) {
        self.documentModel = documentModel
        self.onDismissKeyboard = onDismissKeyboard
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // 标题分组
                ToolbarButton(label: "H1", icon: nil) {
                    documentModel.executeCommand(.heading1)
                }
                ToolbarButton(label: "H2", icon: nil) {
                    documentModel.executeCommand(.heading2)
                }

                Divider()
                    .frame(height: 18)
                    .padding(.horizontal, 2)

                // 行内样式分组
                ToolbarButton(label: "B", icon: nil, isBold: true) {
                    documentModel.executeCommand(.bold)
                }
                ToolbarButton(label: "I", icon: nil, isItalic: true) {
                    documentModel.executeCommand(.italic)
                }
                ToolbarButton(label: "S", icon: "strikethrough") {
                    documentModel.executeCommand(.strikethrough)
                }
                ToolbarButton(label: "</>", icon: nil) {
                    documentModel.executeCommand(.inlineCode)
                }

                Divider()
                    .frame(height: 18)
                    .padding(.horizontal, 2)

                // 列表与块级分组
                ToolbarButton(label: nil, icon: "list.bullet") {
                    documentModel.executeCommand(.bulletList)
                }
                ToolbarButton(label: nil, icon: "list.number") {
                    documentModel.executeCommand(.orderedList)
                }
                ToolbarButton(label: nil, icon: "checklist") {
                    documentModel.executeCommand(.taskList)
                }
                ToolbarButton(label: nil, icon: "text.quote") {
                    documentModel.executeCommand(.blockquote)
                }
                ToolbarButton(label: nil, icon: "link") {
                    documentModel.executeCommand(.link)
                }
                ToolbarButton(label: nil, icon: "tablecells") {
                    documentModel.executeCommand(.table)
                }

                Divider()
                    .frame(height: 18)
                    .padding(.horizontal, 2)

                // 收起键盘
                Button {
                    onDismissKeyboard?()
                    #if canImport(UIKit)
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil,
                        from: nil,
                        for: nil
                    )
                    #endif
                } label: {
                    Image(systemName: "keyboard.chevron.compact.down")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 32)
                        .background(Color.secondary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
        }
        .frame(height: 44)
        .background(.ultraThinMaterial)
    }
}

// MARK: - Toolbar Item Button

private struct ToolbarButton: View {
    let label: String?
    let icon: String?
    var isBold: Bool = false
    var isItalic: Bool = false
    let action: () -> Void

    @State private var isPressed: Bool = false

    var body: some View {
        Button {
            #if canImport(UIKit)
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            #endif
            action()
        } label: {
            Group {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                } else if let label = label {
                    Text(label)
                        .font(.system(
                            size: 14,
                            weight: isBold ? .bold : .semibold,
                            design: .rounded
                        ))
                        .italic(isItalic)
                }
            }
            .foregroundStyle(.primary)
            .frame(minWidth: 32, minHeight: 30)
            .padding(.horizontal, 6)
            .background(isPressed ? Color.accentColor.opacity(0.25) : Color.primary.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .scaleEffect(isPressed ? 0.92 : 1.0)
            .animation(.spring(response: 0.22, dampingFraction: 0.65), value: isPressed)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in isPressed = true }
                .onEnded { _ in isPressed = false }
        )
    }
}
