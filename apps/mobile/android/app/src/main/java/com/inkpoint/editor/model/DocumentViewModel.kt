package com.inkpoint.editor.model

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inkpoint.editor.bridge.EditorMode
import com.inkpoint.editor.bridge.MarkdownCommand
import com.inkpoint.editor.bridge.NativeActionMessage
import com.inkpoint.editor.bridge.OutlineHeading
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject

data class DocumentUiState(
    val title: String = "Untitled.md",
    val markdown: String = "",
    val fileUri: Uri? = null,
    val mode: EditorMode = EditorMode.READ,
    val isDirty: Boolean = false,
    val wordCount: Int = 0,
    val headings: List<OutlineHeading> = emptyList(),
    val isWebViewReady: Boolean = false,
    val statusMessage: String? = null
)

class DocumentViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(DocumentUiState())
    val uiState: StateFlow<DocumentUiState> = _uiState.asStateFlow()

    var onDispatchAction: ((NativeActionMessage) -> Unit)? = null
    private var saveContentResolver: ContentResolver? = null

    companion object {
        private const val TAG = "DocumentViewModel"
        private val SAMPLE_MARKDOWN = """# 欢迎使用 Inkpoint 移动端 📱

> 极简、本地优先、所见即所得。秉承**「即览 (Jilan) + 即改」**设计哲学。

Inkpoint 提供了极致细腻的排版：支持**粗体文本**、*优雅斜体*、~~删除划线~~、==文本高亮强调== 以及 `inline_code()` 行内代码。

---

### 💡 核心特性与效率技巧

> [!NOTE]
> 默认以**沉浸阅读模式**秒级打开文档，零光标遮挡；双击任意段落或点击右下角浮动按钮即可就地激活 CodeMirror 6 极速编辑。

::: tip 极客效率指南
- **双击正文**：直接在双击位置激活就地光标与全键盘编辑
- **键盘附着工具栏**：支持一键加粗、插入代码块、生成列表与撤销重做
- **大纲悬浮导航**：点击右上角目录即可快速跳转长篇章节
:::

::: warning 本地优先隐私承诺
移动端贯彻 **Local-First** 纯离线原则，所有修改直接就地持久化在设备文件系统中，不依赖外部服务器，完全保障数据私密性。
:::

---

### 📐 LaTeX 科学数学公式

行内公式如质能方程 ${'$'}E = mc^2${'$'}，欧拉恒等式 ${'$'}e^{i\pi} + 1 = 0${'$'}。

块级数学公式支持复杂微积分与求和：

${'$'}${'$'}
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}, \quad \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
${'$'}${'$'}

---

### 💻 多语言代码高亮

```typescript
// Type-Safe JSBridge 离线通信架构
export interface InkpointBridge {
  execCommand(command: "bold" | "italic" | "h1" | "code"): void;
  notifyOutline(items: OutlineItem[]): void;
}
```

```kotlin
// Android 原生键盘与 JSBridge 交互
val bridge = AndroidBridgeInterface(viewModel)
bridge.dispatchAction(NativeActionMessage("execCommand"))
```

```rust
// Tauri 原生极速离线内核
fn render_markdown_securely(raw: &str) -> Result<String, String> {
    println!("Inkpoint local-first engine active.");
    Ok(raw.to_string())
}
```

---

### 📊 Mermaid 交互式流程图

```mermaid
graph TD
  A[📄 本地 Markdown] --> B(⚡️ 沉浸即览)
  B -->|双击就地激发| C{📝 CM6 编辑}
  C -->|键盘工具栏操作| D[✨ 实时所见即所得]
  D -->|自动无感保存| E[💾 本地文件存储]
```

---

### 📋 结构化数据与任务清单

| 平台模块 | 技术栈 | 启动耗时 | 渲染引擎 |
| :--- | :--- | :--- | :--- |
| **iOS App** | SwiftUI 6 + WKWebView | < 80ms | CodeMirror 6 |
| **Android App** | Jetpack Compose + WebView | < 90ms | CodeMirror 6 |
| **Desktop 端** | Tauri 2.0 + Rust + React | < 120ms | CodeMirror 6 |

- [x] CodeMirror 6 移动端极速自绘选区
- [x] 官方插件全面接入（高亮、容器指令、KaTeX、Mermaid）
- [x] 原生键盘附着工具栏与弹簧手感触控反馈
- [ ] 跨端本地局域网点对点实时协作
"""
    }

    init {
        loadSampleDocument()
    }

    // MARK: - Document Loading

    fun loadSampleDocument() {
        _uiState.update {
            it.copy(
                title = "Welcome.md",
                markdown = SAMPLE_MARKDOWN,
                fileUri = null,
                isDirty = false,
                wordCount = SAMPLE_MARKDOWN.length
            )
        }
        if (_uiState.value.isWebViewReady) {
            syncToWebView()
        }
    }

    fun openDocument(uri: Uri, contentResolver: ContentResolver) {
        viewModelScope.launch {
            try {
                // 尝试保持 SAF 长久持久化权限
                try {
                    contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to take persistable URI permission (normal for non-SAF URIs)", e)
                }

                var displayName = "Document.md"
                contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex != -1 && cursor.moveToFirst()) {
                        displayName = cursor.getString(nameIndex) ?: displayName
                    }
                }

                val content = contentResolver.openInputStream(uri)?.bufferedReader()?.use {
                    it.readText()
                } ?: ""

                _uiState.update {
                    it.copy(
                        title = displayName,
                        markdown = content,
                        fileUri = uri,
                        isDirty = false,
                        wordCount = content.length,
                        statusMessage = "已加载: $displayName"
                    )
                }

                if (_uiState.value.isWebViewReady) {
                    syncToWebView()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open document from URI: $uri", e)
                _uiState.update { it.copy(statusMessage = "打开文档失败: ${e.localizedMessage}") }
            }
        }
    }

    // MARK: - Web Sync & Actions

    fun notifyWebViewReady() {
        _uiState.update { it.copy(isWebViewReady = true) }
        syncToWebView()
    }

    fun syncToWebView() {
        val state = _uiState.value
        val payload = JSONObject().apply {
            put("markdown", state.markdown)
            put("content", state.markdown)
            put("mode", state.mode.value)
            put("initialMode", state.mode.value)
            put("title", state.title)
        }
        onDispatchAction?.invoke(NativeActionMessage(action = "loadDocument", payload = payload))
    }

    fun toggleMode() {
        val nextMode = if (_uiState.value.mode == EditorMode.READ) EditorMode.EDIT else EditorMode.READ
        setMode(nextMode)
    }

    fun setMode(newMode: EditorMode) {
        if (_uiState.value.mode == newMode) return
        _uiState.update { it.copy(mode = newMode) }
        val payload = JSONObject().apply {
            put("mode", newMode.value)
        }
        onDispatchAction?.invoke(NativeActionMessage(action = "setMode", payload = payload))
    }

    fun executeCommand(command: MarkdownCommand) {
        val payload = JSONObject().apply {
            put("command", command.value)
        }
        onDispatchAction?.invoke(NativeActionMessage(action = "execCommand", payload = payload))
    }

    fun scrollToHeading(headingId: String) {
        val payload = JSONObject().apply {
            put("headingId", headingId)
        }
        onDispatchAction?.invoke(NativeActionMessage(action = "scrollToHeading", payload = payload))
    }

    // MARK: - Save Handlers

    fun requestSave(contentResolver: ContentResolver) {
        this.saveContentResolver = contentResolver
        onDispatchAction?.invoke(NativeActionMessage(action = "requestContent"))
    }

    fun handleSaveResponse(markdown: String, isSuccess: Boolean) {
        if (!isSuccess) {
            _uiState.update { it.copy(statusMessage = "文档内容获取失败") }
            return
        }

        _uiState.update { it.copy(markdown = markdown, isDirty = false) }

        val uri = _uiState.value.fileUri
        val resolver = saveContentResolver
        if (uri != null && resolver != null) {
            viewModelScope.launch {
                try {
                    resolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use {
                        it.write(markdown)
                    }
                    _uiState.update { it.copy(statusMessage = "保存成功") }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to write document to SAF URI", e)
                    _uiState.update { it.copy(statusMessage = "保存写入失败: ${e.localizedMessage}") }
                }
            }
        } else {
            _uiState.update { it.copy(statusMessage = "文档已在内存中更新") }
        }
        this.saveContentResolver = null
    }

    fun handleContentChange(isDirty: Boolean, wordCount: Int) {
        _uiState.update { it.copy(isDirty = isDirty, wordCount = wordCount) }
    }

    fun handleOutlineExtracted(headings: List<OutlineHeading>) {
        _uiState.update { it.copy(headings = headings) }
    }
}
