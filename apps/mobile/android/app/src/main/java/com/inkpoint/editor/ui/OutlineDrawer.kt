package com.inkpoint.editor.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inkpoint.editor.bridge.OutlineHeading

/**
 * 移动端文档大纲抽屉 (Modal Bottom Sheet)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OutlineDrawer(
    headings: List<OutlineHeading>,
    onSelectHeading: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 32.dp)
        ) {
            Text(
                text = "文档大纲",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp)
            )

            if (headings.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "暂无大纲信息\n在文档中输入 # 标题即可自动生成",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 14.sp
                    )
                }
            } else {
                LazyColumn {
                    items(headings) { heading ->
                        OutlineItemRow(
                            heading = heading,
                            onClick = {
                                onSelectHeading(heading.headingId)
                                onDismiss()
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OutlineItemRow(
    heading: OutlineHeading,
    onClick: () -> Unit
) {
    val indent = ((heading.level - 1).coerceAtLeast(0) * 16).dp

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Spacer(modifier = Modifier.width(indent))

        Surface(
            modifier = Modifier.size(6.dp),
            shape = CircleShape,
            color = when (heading.level) {
                1 -> MaterialTheme.colorScheme.primary
                2 -> MaterialTheme.colorScheme.secondary
                else -> MaterialTheme.colorScheme.tertiary
            }
        ) {}

        Spacer(modifier = Modifier.width(10.dp))

        Text(
            text = heading.text,
            fontSize = when (heading.level) {
                1 -> 15.sp
                2 -> 14.sp
                else -> 13.sp
            },
            fontWeight = if (heading.level == 1) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f)
        )

        Text(
            text = "H${heading.level}",
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.outline
        )
    }
}
