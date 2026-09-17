package com.inkpoint.editor.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FormatListBulleted
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.FormatStrikethrough
import androidx.compose.material.icons.filled.KeyboardHide
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inkpoint.editor.bridge.MarkdownCommand

/**
 * 响应软键盘高度的 Markdown 快捷格式化工具栏
 */
@Composable
fun KeyboardAccessoryBar(
    visible: Boolean,
    onExecuteCommand: (MarkdownCommand) -> Unit,
    modifier: Modifier = Modifier
) {
    val haptic = LocalHapticFeedback.current
    val keyboardController = LocalSoftwareKeyboardController.current

    AnimatedVisibility(
        visible = visible,
        enter = slideInVertically(initialOffsetY = { it }),
        exit = slideOutVertically(targetOffsetY = { it }),
        modifier = modifier
    ) {
        Surface(
            tonalElevation = 6.dp,
            shadowElevation = 4.dp,
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // 标题分组
                ToolbarTextButton(label = "H1") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.HEADING_1)
                }
                ToolbarTextButton(label = "H2") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.HEADING_2)
                }

                VerticalDivider(modifier = Modifier.height(20.dp).padding(horizontal = 2.dp))

                // 行内样式
                ToolbarIconButton(icon = Icons.Default.FormatBold, contentDescription = "Bold") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.BOLD)
                }
                ToolbarIconButton(icon = Icons.Default.FormatItalic, contentDescription = "Italic") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.ITALIC)
                }
                ToolbarIconButton(icon = Icons.Default.FormatStrikethrough, contentDescription = "Strikethrough") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.STRIKETHROUGH)
                }
                ToolbarIconButton(icon = Icons.Default.Code, contentDescription = "Inline Code") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.INLINE_CODE)
                }

                VerticalDivider(modifier = Modifier.height(20.dp).padding(horizontal = 2.dp))

                // 块级样式
                ToolbarIconButton(icon = Icons.AutoMirrored.Filled.FormatListBulleted, contentDescription = "Bullet List") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.BULLET_LIST)
                }
                ToolbarIconButton(icon = Icons.Default.FormatListNumbered, contentDescription = "Numbered List") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.ORDERED_LIST)
                }
                ToolbarIconButton(icon = Icons.Default.Checklist, contentDescription = "Task List") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.TASK_LIST)
                }
                ToolbarIconButton(icon = Icons.Default.FormatQuote, contentDescription = "Quote") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.BLOCKQUOTE)
                }
                ToolbarIconButton(icon = Icons.Default.Link, contentDescription = "Link") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.LINK)
                }
                ToolbarIconButton(icon = Icons.Default.TableChart, contentDescription = "Table") {
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onExecuteCommand(MarkdownCommand.TABLE)
                }

                VerticalDivider(modifier = Modifier.height(20.dp).padding(horizontal = 2.dp))

                // 收起键盘
                ToolbarIconButton(
                    icon = Icons.Default.KeyboardHide,
                    contentDescription = "Hide Keyboard",
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                ) {
                    keyboardController?.hide()
                }
            }
        }
    }
}

@Composable
private fun ToolbarTextButton(
    label: String,
    onClick: () -> Unit
) {
    FilledTonalIconButton(
        onClick = onClick,
        modifier = Modifier.size(36.dp),
        shape = RoundedCornerShape(8.dp),
        colors = IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f)
        )
    ) {
        Text(
            text = label,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSecondaryContainer
        )
    }
}

@Composable
private fun ToolbarIconButton(
    icon: ImageVector,
    contentDescription: String,
    containerColor: Color = Color.Unspecified,
    onClick: () -> Unit
) {
    val resolvedColor = if (containerColor != Color.Unspecified) {
        containerColor
    } else {
        MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f)
    }

    FilledTonalIconButton(
        onClick = onClick,
        modifier = Modifier.size(36.dp),
        shape = RoundedCornerShape(8.dp),
        colors = IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = resolvedColor
        )
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSecondaryContainer
        )
    }
}
