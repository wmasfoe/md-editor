package com.inkpoint.editor.bridge

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.inkpoint.editor.model.DocumentViewModel

/**
 * Android WebView 的 JavascriptInterface 桥接实现
 * 对应前端 window.AndroidBridge.postMessage(jsonString)
 */
class AndroidBridgeInterface(
    private val viewModel: DocumentViewModel,
    private val onHaptic: (HapticFeedbackType) -> Unit,
    private val onOpenUrl: (String) -> Unit
) {
    var webView: WebView? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val TAG = "AndroidBridgeInterface"
    }

    /**
     * 前端通过 window.AndroidBridge.postMessage(jsonString) 调用此方法
     */
    @JavascriptInterface
    fun postMessage(messageJson: String) {
        try {
            val eventMsg = WebEventMessage.fromJson(messageJson)
            mainHandler.post {
                handleIncomingEvent(eventMsg)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing incoming bridge message: $messageJson", e)
        }
    }

    /**
     * 向前端执行 Native Action
     */
    fun dispatchAction(action: NativeActionMessage) {
        val targetWebView = webView ?: run {
            Log.w(TAG, "Cannot dispatch action: webView is null")
            return
        }

        val jsonStr = action.toJsonString()
        val escaped = jsonStr
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")

        val js = "if (window.InkpointBridge) { window.InkpointBridge.dispatchNativeAction(\"$escaped\"); }"

        mainHandler.post {
            targetWebView.evaluateJavascript(js) { result ->
                Log.d(TAG, "JS eval completed for action ${action.action}: $result")
            }
        }
    }

    private fun handleIncomingEvent(eventMsg: WebEventMessage) {
        when (eventMsg.event) {
            "ready", "onDocumentReady" -> {
                viewModel.notifyWebViewReady()
            }
            "contentChange", "onContentChange" -> {
                val isDirty = eventMsg.payload.optBoolean("isDirty", false)
                val wordCount = eventMsg.payload.optInt("wordCount", 0)
                viewModel.handleContentChange(isDirty, wordCount)
            }
            "saveResponse", "onSaveContentResponse" -> {
                val markdown = eventMsg.payload.optString("markdown", eventMsg.payload.optString("content", ""))
                val isSuccess = eventMsg.payload.optBoolean("isSuccess", eventMsg.payload.optBoolean("success", false))
                viewModel.handleSaveResponse(markdown, isSuccess)
            }
            "haptic", "triggerHaptic" -> {
                val typeStr = eventMsg.payload.optString("type", eventMsg.payload.optString("style", ""))
                HapticFeedbackType.fromValue(typeStr)?.let { hapticType ->
                    onHaptic(hapticType)
                }
            }
            "outlineExtracted", "onOutlineExtracted" -> {
                val headingsJson = eventMsg.payload.optJSONArray("headings") ?: eventMsg.payload.optJSONArray("outline")
                val list = mutableListOf<OutlineHeading>()
                if (headingsJson != null) {
                    for (i in 0 until headingsJson.length()) {
                        val item = headingsJson.optJSONObject(i) ?: continue
                        val id = item.optString("headingId", item.optString("id", ""))
                        val text = item.optString("text", "")
                        val level = item.optInt("level", 1)
                        if (id.isNotEmpty()) {
                            list.add(OutlineHeading(id, text, level))
                        }
                    }
                }
                viewModel.handleOutlineExtracted(list)
            }
            "openUrl" -> {
                val url = eventMsg.payload.optString("url", "")
                if (url.isNotEmpty()) {
                    onOpenUrl(url)
                }
            }
            else -> {
                Log.w(TAG, "Unhandled event from web: ${eventMsg.event}")
            }
        }
    }
}
