import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// 诊断日志查看页：把沙盒里的 `inkpoint-launch.log` 直接展示在 App 内，
/// 支持复制与分享。用于「没有 Mac、也访问不到沙盒文件」的侧载环境取崩溃现场。
///
/// 触发方式：
/// 1. 上次运行异常结束时，启动后自动弹出；
/// 2. 导航栏「更多」菜单里的「诊断日志」随时可看。
public struct DiagnosticsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var logText: String = ""
    @State private var copied: Bool = false

    /// 诊断实验开关（A/B 定位用，与 DocumentView 共用同一个键）
    @AppStorage("inkpoint.diag.noKeyboardToolbar") private var diagNoKeyboardToolbar: Bool = false

    private let crashed: Bool

    public init(crashed: Bool = LaunchDiagnostics.previousSessionCrashed) {
        self.crashed = crashed
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(crashed
                        ? "上次运行异常结束。下面是最新的诊断日志，点右上角「复制」或「分享」发出来即可定位问题。"
                        : "下面是 App 的诊断日志，点右上角「复制」或「分享」可发送。")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 6) {
                        Toggle("实验：禁用键盘工具栏", isOn: $diagNoKeyboardToolbar)
                            .font(.system(size: 13))
                        Text("用于定位「点编辑闪退」：开启后进入编辑态不再把工具栏挂到键盘上。关闭本页后点一次「编辑」测试，日志会自动记录结果。")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .background(Color.secondary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    Text(logText.isEmpty ? "（日志为空）" : logText)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(14)
            }
            .navigationTitle(crashed ? "上次运行异常结束" : "诊断日志")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                #if os(iOS)
                ToolbarItem(placement: .topBarLeading) {
                    Button("完成") { dismiss() }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    trailingActions
                }
                #else
                ToolbarItem(placement: .cancellationAction) {
                    Button("完成") { dismiss() }
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    trailingActions
                }
                #endif
            }
            .onAppear { logText = LaunchDiagnostics.logText() }
        }
    }

    @ViewBuilder
    private var trailingActions: some View {
        Button(copied ? "已复制" : "复制") {
            copyToPasteboard()
        }

        if let url = LaunchDiagnostics.logFileURL {
            ShareLink(item: url) {
                Image(systemName: "square.and.arrow.up")
            }
        }
    }

    private func copyToPasteboard() {
        #if canImport(UIKit)
        UIPasteboard.general.string = logText
        copied = true
        #endif
    }
}
