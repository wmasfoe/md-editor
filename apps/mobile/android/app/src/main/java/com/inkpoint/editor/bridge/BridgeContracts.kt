package com.inkpoint.editor.bridge

import org.json.JSONObject
import java.util.UUID

/**
 * Markdown 快捷格式化指令，与前端 contracts.ts 保持 1:1 对齐
 */
enum class MarkdownCommand(val value: String) {
    BOLD("bold"),
    ITALIC("italic"),
    STRIKETHROUGH("strikethrough"),
    INLINE_CODE("code"),
    HEADING_1("h1"),
    HEADING_2("h2"),
    HEADING_3("h3"),
    BULLET_LIST("bulletList"),
    ORDERED_LIST("orderedList"),
    TASK_LIST("taskList"),
    BLOCKQUOTE("quote"),
    CODE_BLOCK("codeBlock"),
    LINK("link"),
    TABLE("table"),
    HORIZONTAL_RULE("hr");

    companion object {
        fun fromValue(value: String): MarkdownCommand? =
            entries.find { it.value == value }
    }
}

/**
 * 移动端编辑器模式
 */
enum class EditorMode(val value: String) {
    READ("read"),
    EDIT("edit");

    companion object {
        fun fromValue(value: String): EditorMode =
            entries.find { it.value == value } ?: READ
    }
}

/**
 * 触感反馈类型
 */
enum class HapticFeedbackType(val value: String) {
    IMPACT_LIGHT("impactLight"),
    IMPACT_MEDIUM("impactMedium"),
    IMPACT_HEAVY("impactHeavy"),
    SELECTION("selection"),
    NOTIFICATION_SUCCESS("notificationSuccess"),
    NOTIFICATION_ERROR("notificationError");

    companion object {
        fun fromValue(value: String): HapticFeedbackType? =
            entries.find { it.value == value }
    }
}

/**
 * 文档大纲项
 */
data class OutlineHeading(
    val headingId: String,
    val text: String,
    val level: Int
)

/**
 * 原生向前端发送的 Action 消息载荷
 */
data class NativeActionMessage(
    val action: String,
    val payload: JSONObject = JSONObject(),
    val messageId: String = UUID.randomUUID().toString()
) {
    fun toJsonString(): String {
        val json = JSONObject()
        json.put("action", action)
        json.put("payload", payload)
        json.put("messageId", messageId)
        return json.toString()
    }
}

/**
 * 前端向原生发送的 Event 消息载荷
 */
data class WebEventMessage(
    val event: String,
    val payload: JSONObject,
    val timestamp: Long
) {
    companion object {
        fun fromJson(jsonStr: String): WebEventMessage {
            val obj = JSONObject(jsonStr)
            val event = obj.optString("event", "")
            val payload = obj.optJSONObject("payload") ?: JSONObject()
            val timestamp = obj.optLong("timestamp", System.currentTimeMillis())
            return WebEventMessage(event, payload, timestamp)
        }
    }
}
