package com.inkpoint.editor.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inkpoint.editor.bridge.AndroidBridgeInterface
import com.inkpoint.editor.bridge.EditorMode
import com.inkpoint.editor.model.DocumentViewModel

/**
 * Inkpoint 移动端核心编辑/阅读主界面
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentScreen(
    viewModel: DocumentViewModel,
    bridge: AndroidBridgeInterface,
    onOpenDocumentPicker: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    var showOutlineDrawer by remember { mutableStateOf(false) }
    var showMoreMenu by remember { mutableStateOf(false) }

    // 监听状态提示信息
    LaunchedEffect(state.statusMessage) {
        state.statusMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
        }
    }

    // 软键盘弹起状态监听
    val isImeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(end = 8.dp)
                    ) {
                        Text(
                            text = state.title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        if (state.isDirty) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .background(Color(0xFFE53E3E), CircleShape)
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onOpenDocumentPicker) {
                        Icon(
                            imageVector = Icons.Default.FolderOpen,
                            contentDescription = "Open Document"
                        )
                    }
                },
                actions = {
                    // 大纲抽屉入口
                    IconButton(onClick = { showOutlineDrawer = true }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.List,
                            contentDescription = "Document Outline"
                        )
                    }

                    // 双态切换按钮 (只读 <-> 编辑)
                    val modeColor by animateColorAsState(
                        targetValue = if (state.mode == EditorMode.EDIT) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            Color.Transparent
                        },
                        label = "modeColor"
                    )

                    Surface(
                        onClick = { viewModel.toggleMode() },
                        shape = RoundedCornerShape(16.dp),
                        color = modeColor,
                        modifier = Modifier.padding(horizontal = 4.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                        ) {
                            Icon(
                                imageVector = if (state.mode == EditorMode.READ) Icons.Default.Edit else Icons.Default.Visibility,
                                contentDescription = "Toggle Mode",
                                modifier = Modifier.size(16.dp),
                                tint = if (state.mode == EditorMode.EDIT) {
                                    MaterialTheme.colorScheme.onPrimaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                }
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = if (state.mode == EditorMode.READ) "编辑" else "阅读",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                color = if (state.mode == EditorMode.EDIT) {
                                    MaterialTheme.colorScheme.onPrimaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                }
                            )
                        }
                    }

                    // 更多菜单
                    IconButton(onClick = { showMoreMenu = true }) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = "More Options"
                        )
                    }

                    DropdownMenu(
                        expanded = showMoreMenu,
                        onDismissRequest = { showMoreMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("立即保存") },
                            onClick = {
                                showMoreMenu = false
                                viewModel.requestSave(context.contentResolver)
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("新建示例文件") },
                            onClick = {
                                showMoreMenu = false
                                viewModel.loadSampleDocument()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("字数统计: ${state.wordCount} 字") },
                            onClick = { showMoreMenu = false }
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        content = { paddingValues ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // WebView 占满内容主区域
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    EditorWebView(
                        bridge = bridge,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                // 软键盘弹起且处于编辑态时展示工具栏
                KeyboardAccessoryBar(
                    visible = (isImeVisible || state.mode == EditorMode.EDIT),
                    onExecuteCommand = { command ->
                        viewModel.executeCommand(command)
                    }
                )
            }
        }
    )

    // 大纲抽屉
    if (showOutlineDrawer) {
        OutlineDrawer(
            headings = state.headings,
            onSelectHeading = { headingId ->
                viewModel.scrollToHeading(headingId)
            },
            onDismiss = { showOutlineDrawer = false }
        )
    }
}
