import Foundation
import Darwin

/// 启动诊断日志（用于在「没有 Mac / 没有 Xcode / 拿不到沙盒文件」的环境下定位崩溃）。
///
/// 背景：iOS 端出包走 CI（未签名 IPA → 用户侧载），手边没有 Xcode/Console；
/// 侧载容器（如 LiveContainer）里沙盒文件在「文件」App 中也看不到。
/// 因此诊断必须能在 **App 内部** 取出来：日志写进沙盒 `Documents/inkpoint-launch.log`，
/// 同时由 `DiagnosticsView` 在 App 内直接展示、复制与分享。
///
/// 设计约束：
/// - 只做追加写，不涉及任何 UI 或网络，单次写入几十~几百字节；
/// - 阶段标记**同步**落盘（异步队列可能来不及在崩溃前刷盘，就失去意义了）；
/// - 文件不自动清理，体积可忽略（每次启动约 10~20 行）。
public enum LaunchDiagnostics {
    /// 诊断日志文件名（位于沙盒 Documents 目录）
    public static let fileName = "inkpoint-launch.log"

    /// 会话开始标记（每次启动写一条）
    private static let sessionStartTag = "session: 启动"
    /// 会话正常结束标记（App 进入后台时写一条）
    private static let sessionEndTag = "session: 正常退出"

    /// 上一次运行是否异常结束（App 内展示提示用）
    public private(set) static var previousSessionCrashed = false

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

    /// 记录未捕获的 Objective-C 异常（例如键盘/输入窗口约束冲突抛出的 NSGenericException）
    public static func markUncaughtException(_ exception: NSException) {
        let symbols = exception.callStackSymbols.prefix(20).joined(separator: "\n    ")
        let reason = exception.reason ?? "-"
        append("[\(timestamp())] ❌ UNCAUGHT \(exception.name.rawValue): \(reason)\n    \(symbols)\n")
    }

    /// 安装未捕获异常处理器（应在 App 启动最早期调用）
    public static func installCrashHandler() {
        NSSetUncaughtExceptionHandler(inkpointUncaughtExceptionHandler)
        mark("app: 未捕获异常处理器已安装")
    }

    // MARK: - 硬崩溃（信号）

    /// 信号处理器用的文件描述符：安装时打开，避免在信号上下文里做文件系统操作
    private static var crashFileDescriptor: Int32 = -1

    /// 安装信号处理器。
    ///
    /// 必要性：SIGSEGV/SIGABRT/SIGTRAP 这类**硬崩溃不会走 ObjC 异常处理器**——
    /// 上一版日志里「派发 setMode 后没有任何后续标记、也没有 UNCAUGHT」就是这种情况，
    /// 只有挂信号才能把崩溃类型与调用栈写进日志。
    public static func installSignalHandlers() {
        if crashFileDescriptor < 0, let url = logFileURL {
            crashFileDescriptor = open(url.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        }
        for signalNumber in [SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE] {
            _ = signal(signalNumber, inkpointSignalHandler)
        }
        mark("app: 信号处理器已安装")
    }

    /// 记录当前进程内存占用（phys_footprint，MB）。
    /// 用途：若崩溃是「内存被杀」（Jetsam），进程会被直接干掉、不留下任何崩溃标记，
    /// 采样值就成了唯一线索。
    public static func markMemory(_ label: String) {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rebound in
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), rebound, &count)
            }
        }
        guard result == KERN_SUCCESS else { return }
        let megabytes = Double(info.phys_footprint) / 1024 / 1024
        mark("\(label)：内存 \(String(format: "%.1f", megabytes))MB")
    }

    /// 信号上下文内的最小写入（`write(2)` 是 async-signal-safe 的）
    fileprivate static func writeRaw(_ bytes: UnsafePointer<CChar>, count: Int) {
        guard crashFileDescriptor >= 0 else { return }
        _ = write(crashFileDescriptor, bytes, count)
    }

    /// 信号上下文内的补充写入（best-effort，允许失败）
    fileprivate static func appendRaw(_ text: String) {
        guard crashFileDescriptor >= 0, let data = text.data(using: .utf8) else { return }
        data.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            _ = write(crashFileDescriptor, base, buffer.count)
        }
    }

    /// 开始新会话；返回**上一次**运行是否异常结束。
    @discardableResult
    public static func beginSession() -> Bool {
        let crashed = lastSessionCrashed()
        previousSessionCrashed = crashed
        mark("\(sessionStartTag)（版本 \(versionStamp)）")
        return crashed
    }

    /// 标记正常退出（App 进入后台时调用；前台崩溃时不会执行到这里）
    public static func markCleanExit() {
        mark(sessionEndTag)
    }

    /// 上一次运行是否异常结束：最近一次会话只有「启动」标记、没有「正常退出」标记。
    public static func lastSessionCrashed() -> Bool {
        guard let text = try? String(contentsOf: logTextURL, encoding: .utf8) else { return false }
        for line in text.split(separator: "\n").reversed() {
            if line.contains(sessionEndTag) { return false }
            if line.contains(sessionStartTag) { return true }
        }
        return false
    }

    /// 读取日志文本（供 App 内展示；默认取最后 500 行）
    public static func logText(maxLines: Int = 500) -> String {
        guard let text = try? String(contentsOf: logTextURL, encoding: .utf8) else { return "" }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count > maxLines else { return text }
        return "…（仅显示最后 \(maxLines) 行，共 \(lines.count) 行）\n" +
            lines.suffix(maxLines).joined(separator: "\n")
    }

    // MARK: - 落盘

    /// 读取用路径（沙盒不可用时退化为临时目录，避免展示逻辑崩溃）
    private static var logTextURL: URL {
        logFileURL ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(fileName)
    }

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

    /// 版本号 + 构建号，便于确认现场来自哪个包
    private static var versionStamp: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }
}

/// 未捕获异常处理器的顶层函数实现。
/// `NSSetUncaughtExceptionHandler` 需要 C 函数指针，**不能**传捕获上下文的闭包
/// （否则报 `a C function pointer cannot be formed from a closure that captures context`），
/// 所以这里用全局函数而不是静态方法或闭包。
private func inkpointUncaughtExceptionHandler(_ exception: NSException) {
    LaunchDiagnostics.markUncaughtException(exception)
}

/// 信号处理器（硬崩溃：SIGSEGV / SIGABRT / SIGTRAP 等）。
///
/// 步骤：先用 async-signal-safe 的 `write(2)` 写一行**固定标记**（即使后面卡死也能证明
/// 「是信号崩溃」而不是「被系统内存杀」——后者不会留下任何标记），再尽力附加崩溃线程的调用栈，
/// 最后恢复默认处理并重新抛出，保留系统崩溃报告行为。
private func inkpointSignalHandler(_ signalNumber: Int32) {
    let name: String
    switch signalNumber {
    case SIGABRT: name = "SIGABRT"
    case SIGSEGV: name = "SIGSEGV"
    case SIGBUS: name = "SIGBUS"
    case SIGILL: name = "SIGILL"
    case SIGTRAP: name = "SIGTRAP"
    case SIGFPE: name = "SIGFPE"
    default: name = "SIGNAL_\(signalNumber)"
    }

    let marker = "❌ 信号崩溃（\(name)）\n"
    marker.withCString { pointer in
        LaunchDiagnostics.writeRaw(pointer, count: marker.utf8.count)
    }

    var detail = "调用栈（崩溃线程，最多 40 帧）：\n"
    for (index, frame) in Thread.callStackSymbols.prefix(40).enumerated() {
        detail += "  \(index) \(frame)\n"
    }
    LaunchDiagnostics.appendRaw(detail)

    _ = signal(signalNumber, SIG_DFL)
    _ = raise(signalNumber)
}
