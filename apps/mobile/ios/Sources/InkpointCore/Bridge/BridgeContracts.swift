import Foundation

// MARK: - Markdown Commands

/// Markdown 快捷格式化指令，与前端 contracts.ts 保持 1:1 对齐
public enum MarkdownCommand: String, Codable, CaseIterable, Sendable {
    case bold = "bold"
    case italic = "italic"
    case strikethrough = "strikethrough"
    case inlineCode = "code"
    case heading1 = "h1"
    case heading2 = "h2"
    case heading3 = "h3"
    case bulletList = "bulletList"
    case orderedList = "orderedList"
    case taskList = "taskList"
    case blockquote = "quote"
    case codeBlock = "codeBlock"
    case link = "link"
    case table = "table"
    case horizontalRule = "hr"
}

// MARK: - Editor Mode

/// 移动端展示模式：只读预览态 / 交互编辑态
public enum EditorMode: String, Codable, Sendable {
    case read = "read"
    case edit = "edit"
}

// MARK: - Outline

/// 文档大纲项
public struct OutlineHeading: Codable, Identifiable, Hashable, Sendable {
    public var id: String { headingId }
    public let headingId: String
    public let text: String
    public let level: Int

    public init(headingId: String, text: String, level: Int) {
        self.headingId = headingId
        self.text = text
        self.level = level
    }
}

// MARK: - Haptic Types

/// 原生触感反馈类型
public enum HapticFeedbackType: String, Codable, Sendable {
    case impactLight = "impactLight"
    case impactMedium = "impactMedium"
    case impactHeavy = "impactHeavy"
    case selection = "selection"
    case notificationSuccess = "notificationSuccess"
    case notificationError = "notificationError"
}

// MARK: - AnyCodable Helper

/// 轻量级 AnyCodable，支持 JSON 动态键值解析，无需外部第三方库
public enum AnyCodable: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([AnyCodable])
    case dictionary([String: AnyCodable])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let val = try? container.decode(Bool.self) {
            self = .bool(val)
        } else if let val = try? container.decode(Int.self) {
            self = .int(val)
        } else if let val = try? container.decode(Double.self) {
            self = .double(val)
        } else if let val = try? container.decode(String.self) {
            self = .string(val)
        } else if let val = try? container.decode([AnyCodable].self) {
            self = .array(val)
        } else if let val = try? container.decode([String: AnyCodable].self) {
            self = .dictionary(val)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "AnyCodable: Unknown value type")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let val):
            try container.encode(val)
        case .int(let val):
            try container.encode(val)
        case .double(let val):
            try container.encode(val)
        case .string(let val):
            try container.encode(val)
        case .array(let val):
            try container.encode(val)
        case .dictionary(let val):
            try container.encode(val)
        }
    }

    public var stringValue: String? {
        if case .string(let str) = self { return str }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    public var intValue: Int? {
        if case .int(let i) = self { return i }
        if case .double(let d) = self { return Int(d) }
        return nil
    }
}

// MARK: - Bridge Protocol Messages

/// 原生向前端发送的 Action 消息
public struct NativeActionMessage: Codable, Sendable {
    public let action: String
    public let payload: [String: AnyCodable]
    public let messageId: String

    public init(action: String, payload: [String: AnyCodable] = [:], messageId: String = UUID().uuidString) {
        self.action = action
        self.payload = payload
        self.messageId = messageId
    }

    public func toJSONString() -> String? {
        guard let data = try? JSONEncoder().encode(self),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return json
    }
}

/// 前端向原生发送的 Event 消息
public struct WebEventMessage: Codable, Sendable {
    public let event: String
    public let payload: [String: AnyCodable]
    public let timestamp: Int64
}
