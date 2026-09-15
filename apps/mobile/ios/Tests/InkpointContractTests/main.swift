import Foundation
import InkpointCore

func assertTrue(_ condition: Bool, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    if !condition {
        print("❌ Assertion failed: \(message) at \(file):\(line)")
        exit(1)
    }
}

func assertEqual<T: Equatable>(_ a: T, _ b: T, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    if a != b {
        print("❌ Assertion failed: '\(a)' != '\(b)' [\(message)] at \(file):\(line)")
        exit(1)
    }
}

print("🧪 Running Inkpoint iOS Bridge Contract & Model Test Suite...")

// Test 1: MarkdownCommand Raw Values
print("  - [1/6] Testing MarkdownCommand raw values...")
assertEqual(MarkdownCommand.bold.rawValue, "bold")
assertEqual(MarkdownCommand.italic.rawValue, "italic")
assertEqual(MarkdownCommand.strikethrough.rawValue, "strikethrough")
assertEqual(MarkdownCommand.inlineCode.rawValue, "code")
assertEqual(MarkdownCommand.heading1.rawValue, "h1")
assertEqual(MarkdownCommand.heading2.rawValue, "h2")
assertEqual(MarkdownCommand.heading3.rawValue, "h3")
assertEqual(MarkdownCommand.bulletList.rawValue, "bulletList")
assertEqual(MarkdownCommand.orderedList.rawValue, "orderedList")
assertEqual(MarkdownCommand.taskList.rawValue, "taskList")
assertEqual(MarkdownCommand.blockquote.rawValue, "quote")
assertEqual(MarkdownCommand.codeBlock.rawValue, "codeBlock")
assertEqual(MarkdownCommand.link.rawValue, "link")
assertEqual(MarkdownCommand.table.rawValue, "table")
assertEqual(MarkdownCommand.horizontalRule.rawValue, "hr")
assertEqual(MarkdownCommand.allCases.count, 15)

// Test 2: NativeActionMessage Serialization
print("  - [2/6] Testing NativeActionMessage JSON serialization...")
let action = NativeActionMessage(
    action: "execCommand",
    payload: ["command": .string("bold")],
    messageId: "test-msg-123"
)
guard let json = action.toJSONString(),
      let data = json.data(using: .utf8) else {
    print("❌ Failed to serialize action to JSON string")
    exit(1)
}
let decodedAction = try JSONDecoder().decode(NativeActionMessage.self, from: data)
assertEqual(decodedAction.action, "execCommand")
assertEqual(decodedAction.messageId, "test-msg-123")
assertEqual(decodedAction.payload["command"]?.stringValue, "bold")

// Test 3: WebEventMessage Deserialization
print("  - [3/6] Testing WebEventMessage JSON deserialization...")
let rawWebEventJson = """
{
    "event": "contentChange",
    "payload": {
        "isDirty": true,
        "wordCount": 1024
    },
    "timestamp": 1726350000000
}
"""
let eventData = rawWebEventJson.data(using: .utf8)!
let decodedEvent = try JSONDecoder().decode(WebEventMessage.self, from: eventData)
assertEqual(decodedEvent.event, "contentChange")
assertEqual(decodedEvent.payload["isDirty"]?.boolValue, true)
assertEqual(decodedEvent.payload["wordCount"]?.intValue, 1024)
assertEqual(decodedEvent.timestamp, 1726350000000)

// Test 4: OutlineHeading Encoding & Decoding
print("  - [4/6] Testing OutlineHeading model extraction...")
let heading = OutlineHeading(headingId: "header-1", text: "Introduction", level: 1)
assertEqual(heading.id, "header-1")
assertEqual(heading.level, 1)
assertEqual(heading.text, "Introduction")
let headingData = try JSONEncoder().encode(heading)
let decodedHeading = try JSONDecoder().decode(OutlineHeading.self, from: headingData)
assertEqual(decodedHeading.headingId, "header-1")
assertEqual(decodedHeading.text, "Introduction")
assertEqual(decodedHeading.level, 1)

// Test 5: DocumentModel Lifecycle & Transitions
print("  - [5/6] Testing DocumentModel lifecycle & mode transitions...")
Task { @MainActor in
    let model = DocumentModel(initialMarkdown: "# Test Title\nSome content")
    assertEqual(model.mode, .read)
    assertEqual(model.title, "Sample Document.md")
    assertTrue(!model.isDirty, "Initial document should not be dirty")

    // 切换模式测试
    model.toggleMode()
    assertEqual(model.mode, .edit)

    model.toggleMode()
    assertEqual(model.mode, .read)

    // 内容与脏标记更新
    model.handleContentChange(isDirty: true, wordCount: 42)
    assertTrue(model.isDirty, "Document should be dirty after change")
    assertEqual(model.wordCount, 42)

    // 大纲提取更新
    let headings = [
        OutlineHeading(headingId: "h-1", text: "First", level: 1),
        OutlineHeading(headingId: "h-2", text: "Second", level: 2)
    ]
    model.handleOutlineExtracted(headings: headings)
    assertEqual(model.headings.count, 2)
    assertEqual(model.headings[0].text, "First")

    // 保存响应处理
    model.handleSaveResponse(markdown: "# Updated Title", isSuccess: true)
    assertTrue(!model.isDirty, "Document should not be dirty after successful save")
    assertEqual(model.markdown, "# Updated Title")
}

// Test 6: Haptic Feedback Parsing
print("  - [6/6] Testing HapticFeedbackType parsing...")
assertEqual(HapticFeedbackType(rawValue: "impactLight"), .impactLight)
assertEqual(HapticFeedbackType(rawValue: "impactHeavy"), .impactHeavy)
assertEqual(HapticFeedbackType(rawValue: "selection"), .selection)
assertEqual(HapticFeedbackType(rawValue: "notificationSuccess"), .notificationSuccess)
assertTrue(HapticFeedbackType(rawValue: "unknown") == nil, "Unknown haptic type should be nil")

print("✅ All 6 test suites passed successfully!")
