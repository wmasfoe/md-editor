package com.inkpoint.editor.ui

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import com.inkpoint.editor.bridge.AndroidBridgeInterface

/**
 * Compose 包装的 Android 原生 WebView
 * 承载离线 CodeMirror 6 编辑/阅读双态渲染器
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EditorWebView(
    bridge: AndroidBridgeInterface,
    modifier: Modifier = Modifier
) {
    AndroidView(
        factory = { context ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()

            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )

                setBackgroundColor(Color.TRANSPARENT)

                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = true
                    allowContentAccess = true
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    cacheMode = WebSettings.LOAD_DEFAULT
                    mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                }

                // 注册双向 Bridge 接口
                addJavascriptInterface(bridge, "AndroidBridge")
                bridge.webView = this

                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest
                    ): WebResourceResponse? {
                        return assetLoader.shouldInterceptRequest(request.url)
                    }

                    override fun onPageFinished(view: WebView?, url: String?) {
                        super.onPageFinished(view, url)
                        // 页面加载完成后可注入初始状态
                    }
                }

                // 加载离线资产包
                // 优先通过 assetLoader 虚拟域名安全加载，避免 file:// 同源隔离限制
                loadUrl("https://appassets.androidplatform.net/assets/editor/index.html")
            }
        },
        update = { webView ->
            bridge.webView = webView
        },
        modifier = modifier
    )
}
