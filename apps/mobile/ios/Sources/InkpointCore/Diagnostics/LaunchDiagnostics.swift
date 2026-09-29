import Foundation

/// 启动诊断日志（用于在「没有 Mac / 没有 Xcode」的环境下定位启动闪退）。
///
/// 背景：iOS 端出包走 CI（未签名 IPA → 用户自签安装），手边没有 Xcode/Console，
/// 一旦「启动即闪退」就完全没有现场。这里把启动阶段标记与未捕获异常写进沙盒
/// `Documents/inkpoint-launch.log`；App 已开启 `UIFileSharingEnabled`，
/// 可直接在系统「文件」App 的「我的 iPhone → Inkpoint」里查看或分享，无需数据线。
///
/// 设计约束：
/// - 只做追加写，不涉及任何 UI 或网络，单次写入几十~几百字节；
/// - 阶段标记**同步**落盘（异步队列可能来不及在崩溃前刷盘，就失去意义了）；
/// - 文件不自动清理，体积可忽略（每次启动约 5~10 行）。
public enum LaunchDiagnostics {
    /// 诊断日志文件名（位于沙盒 Documents 目录）
    public static let fileName = "inkpoint-launch.log"

    /// 诊断日志完整路径
    public static var logFileURL: URL? {
        FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(fileName)
    }

    /// 记录一个启动阶段标记
    public static func mark(_ stage: String) {
        append("[\(timestamp())] \(stage)\n")
    }

    /// 记录未捕获的 Objective-C 异常（例如 KVC 访问不存在的 key 抛出的 NSUnknownKeyException）
    public static func markUncaughtException(_ exception: NSException) {
        let symbols = exception.callStackSymbols.prefix(20).joined(separator: "\n    ")
        let reason = exception.reason ?? "-"
        append("[\(timestamp())] ❌ UNCAUGHT \(exception.name.rawValue): \(reason)\n    \(symbols)\n")
    }

    /// 安装未捕获异常处理器（应在 App 启动最早期调用）
    public static func installCrashHandler() {
        NSSetUncaughtExceptionHandler { exception in
            markUncaughtException(exception)
        }
        mark("app: 未捕获异常处理器已安装")
    }

    // MARK: - 落盘

    private static func append(_ line: String) {
        guard let url = logFileURL, let data = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            // 首次写入：文件还不存在
            try? data.write(to: url, options: .atomic)
        }
    }

    private static func timestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
