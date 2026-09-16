package com.inkpoint.editor

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import com.inkpoint.editor.bridge.AndroidBridgeInterface
import com.inkpoint.editor.bridge.HapticFeedbackType
import com.inkpoint.editor.model.DocumentViewModel
import com.inkpoint.editor.ui.DocumentScreen

class MainActivity : ComponentActivity() {

    private val viewModel: DocumentViewModel by viewModels()

    private val bridge by lazy {
        AndroidBridgeInterface(
            viewModel = viewModel,
            onHaptic = { type -> performHaptic(type) },
            onOpenUrl = { url ->
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                startActivity(intent)
            }
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // 建立 ViewModel 与 Bridge 发送钩子的双向连接
        viewModel.onDispatchAction = { action ->
            bridge.dispatchAction(action)
        }

        // 处理从系统外部打开文件的 Intent
        handleIncomingIntent(intent)

        setContent {
            val isDark = isSystemInDarkTheme()
            val colorScheme = if (isDark) darkColorScheme() else lightColorScheme()

            // SAF 系统文件选择器注册
            val documentPickerLauncher = rememberLauncherForActivityResult(
                contract = ActivityResultContracts.OpenDocument()
            ) { uri: Uri? ->
                uri?.let {
                    viewModel.openDocument(it, contentResolver)
                }
            }

            MaterialTheme(colorScheme = colorScheme) {
                DocumentScreen(
                    viewModel = viewModel,
                    bridge = bridge,
                    onOpenDocumentPicker = {
                        documentPickerLauncher.launch(
                            arrayOf("text/markdown", "text/plain", "*/*")
                        )
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        viewModel.openDocument(uri, contentResolver)
    }

    private fun performHaptic(type: HapticFeedbackType) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as? Vibrator
        } ?: return

        if (!vibrator.hasVibrator()) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val effect = when (type) {
                HapticFeedbackType.IMPACT_LIGHT -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
                HapticFeedbackType.IMPACT_MEDIUM -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
                HapticFeedbackType.IMPACT_HEAVY -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)
                HapticFeedbackType.SELECTION -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
                HapticFeedbackType.NOTIFICATION_SUCCESS -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK)
                HapticFeedbackType.NOTIFICATION_ERROR -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK)
            }
            vibrator.vibrate(effect)
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(20)
        }
    }
}
