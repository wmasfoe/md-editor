package com.inkpoint.editor

import com.inkpoint.editor.bridge.EditorMode
import com.inkpoint.editor.bridge.HapticFeedbackType
import com.inkpoint.editor.bridge.MarkdownCommand
import com.inkpoint.editor.bridge.NativeActionMessage
import com.inkpoint.editor.bridge.OutlineHeading
import com.inkpoint.editor.bridge.WebEventMessage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeContractTest {

    @Test
    fun testMarkdownCommandRawValues() {
        assertEquals("bold", MarkdownCommand.BOLD.value)
        assertEquals("italic", MarkdownCommand.ITALIC.value)
        assertEquals("strikethrough", MarkdownCommand.STRIKETHROUGH.value)
        assertEquals("code", MarkdownCommand.INLINE_CODE.value)
        assertEquals("h1", MarkdownCommand.HEADING_1.value)
        assertEquals("h2", MarkdownCommand.HEADING_2.value)
        assertEquals("h3", MarkdownCommand.HEADING_3.value)
        assertEquals("bulletList", MarkdownCommand.BULLET_LIST.value)
        assertEquals("orderedList", MarkdownCommand.ORDERED_LIST.value)
        assertEquals("taskList", MarkdownCommand.TASK_LIST.value)
        assertEquals("quote", MarkdownCommand.BLOCKQUOTE.value)
        assertEquals("codeBlock", MarkdownCommand.CODE_BLOCK.value)
        assertEquals("link", MarkdownCommand.LINK.value)
        assertEquals("table", MarkdownCommand.TABLE.value)
        assertEquals("hr", MarkdownCommand.HORIZONTAL_RULE.value)
        assertEquals(15, MarkdownCommand.entries.size)
    }

    @Test
    fun testNativeActionMessageSerialization() {
        val payload = JSONObject().apply {
            put("command", "bold")
        }
        val action = NativeActionMessage(
            action = "execCommand",
            payload = payload,
            messageId = "test-android-123"
        )
        val jsonStr = action.toJsonString()
        assertNotNull(jsonStr)

        val json = JSONObject(jsonStr)
        assertEquals("execCommand", json.getString("action"))
        assertEquals("test-android-123", json.getString("messageId"))
        assertEquals("bold", json.getJSONObject("payload").getString("command"))
    }

    @Test
    fun testWebEventMessageDeserialization() {
        val rawJson = """
        {
            "event": "contentChange",
            "payload": {
                "isDirty": true,
                "wordCount": 2048
            },
            "timestamp": 1726350000000
        }
        """.trimIndent()

        val event = WebEventMessage.fromJson(rawJson)
        assertEquals("contentChange", event.event)
        assertTrue(event.payload.getBoolean("isDirty"))
        assertEquals(2048, event.payload.getInt("wordCount"))
        assertEquals(1726350000000L, event.timestamp)
    }

    @Test
    fun testOutlineHeadingModel() {
        val heading = OutlineHeading(
            headingId = "header-intro",
            text = "Introduction to Inkpoint",
            level = 1
        )
        assertEquals("header-intro", heading.headingId)
        assertEquals("Introduction to Inkpoint", heading.text)
        assertEquals(1, heading.level)
    }

    @Test
    fun testEditorModeParsing() {
        assertEquals(EditorMode.READ, EditorMode.fromValue("read"))
        assertEquals(EditorMode.EDIT, EditorMode.fromValue("edit"))
        assertEquals(EditorMode.READ, EditorMode.fromValue("unknown_mode"))
    }

    @Test
    fun testHapticFeedbackParsing() {
        assertEquals(HapticFeedbackType.IMPACT_LIGHT, HapticFeedbackType.fromValue("impactLight"))
        assertEquals(HapticFeedbackType.IMPACT_HEAVY, HapticFeedbackType.fromValue("impactHeavy"))
        assertEquals(HapticFeedbackType.SELECTION, HapticFeedbackType.fromValue("selection"))
        assertEquals(HapticFeedbackType.NOTIFICATION_SUCCESS, HapticFeedbackType.fromValue("notificationSuccess"))
        assertNull(HapticFeedbackType.fromValue("invalid"))
    }
}
