# 多平台分发与边缘加速架构方案 (Multi-Platform Distribution & Edge Accelerator)

## 1. 背景与核心动机

在 Inkpoint 逐步演进为覆盖桌面端（macOS/Windows/Linux）、Web 在线端、uTools 插件及移动端（iOS/Android）的全平台 Markdown/MDX 编辑器后，传统单仓库软件分发方案面临三大致命痛点：

1. **GitHub Releases 全局单 `Latest` 徽标冲突**：
   GitHub Releases 采用单一全局时间线排序。如果移动端频繁发布小修补版本（如 `android-v0.1.1`），会立即抢占主仓库的 `Latest` 徽标，导致桌面端用户打开 Release 页面发现最新版变成了安卓 APK，版本号与安装包平台产生严重混乱。
2. **移动端分发生态差异**：
   iOS 依靠 App Store / TestFlight，Android 依靠 APK / 应用市场，而桌面端依靠 DMG/EXE/AppImage。各端发版节奏与用户群完全不同。
3. **中国大陆地区 GitHub 下载网络瓶颈**：
   桌面端安装包存放在 GitHub Releases（底层为 AWS/Azure 对象存储），国内部分省份网络经常发生解析超时或连接中断。
4. **云存储出网流量（Egress）陷阱**：
   自建 S3 / OSS 存储安装包，出网流量费单价昂贵（0.5~0.8 元/GB）。而 **Cloudflare R2 提供永久 0 元出网流量费（Zero Egress Fees）**，配合 **Cloudflare Worker 全球 Anycast 边缘网络**，是目前性价比与性能最优的解法。

---

## 2. 架构拓扑与数据流向

```
                               ┌────────────────────────────────────────────────────────┐
                               │       download.justdev.cn (Cloudflare Worker)          │
                               │                统一全球边缘加速网关                    │
                               └───────────────────────────┬────────────────────────────┘
                                                           │
                        ┌──────────────────────────────────┴──────────────────────────────────┐
                        ▼                                                                     ▼
    【Desktop 路由】/:app/desktop/:platform/latest                        【Mobile 路由】/:app/android/latest
    • 回源目标：GitHub Releases (wmasfoe/md-editor)                      • 回源目标：Cloudflare R2 存储桶 (inkpoint-releases)
    • 模式：Edge 流式反向代理 + 边缘强缓存 (Cache API)                    • 模式：R2 原生对象直出
    • 优势：0 额外 R2 存储占用，国内免梯秒速下载                          • 优势：10GB 免费额度内，免出网流量费
                        │                                                                     │
                        └──────────────────────────────────┬──────────────────────────────────┘
                                                           │
                                                           ▼
                                            【元数据 API】/api/:app/version.json
                                            • 结构化返回多端最新版本、直链、更新日志
                                            • 供官网下载面板、各客户端内自动检查更新
```

---

## 3. Worker 工程设计 (`apps/distribution-worker`)

### 3.1 路由契约规范

| 路由路径 | 目标与行为 | 缓存策略 |
| :--- | :--- | :--- |
| `GET /` | 返回边缘网关健康状态与路由清单 | `no-cache` |
| `GET /api/:app/version.json` | 获取指定应用的跨端版本元数据清单 | `public, max-age=300` |
| `GET /api/version.json` | 默认获取主应用 `inkpoint` 的版本元数据清单 | `public, max-age=300` |
| `GET /:app/desktop/:platform/latest` | 查询 GitHub API 匹配对应平台的最新安装包并流式代理加速 | `public, max-age=86400, s-maxage=2592000` |
| `GET /:app/android/latest` | 直出 R2 中最新版本的 Android APK 安装包 | `public, max-age=3600, s-maxage=86400` |
| `GET /:app/:platform/:version/:file` | 精确下载特定版本的归档资产（移动端读 R2，桌面端读 GitHub） | `public, max-age=2592000` |
| `GET /gh/*` | 通用 GitHub 资产边缘反向代理 | `public, max-age=2592000` |

### 3.2 大文件流式代理与断点续传（Range Requests）
Worker 在代理 GitHub 大文件（如 100MB DMG）时，不一次性读取到内存中，而是通过 Web Standard `ReadableStream` 进行流式透传，并将客户端的 `Range: bytes=...` 请求头透明透传给源站，支持客户端与浏览器断点续传和多线程下载。

---

## 4. 多 App 通用存储目录规范 (R2 Bucket)

```text
{app}/
  ├── android/
  │   ├── {version}/Inkpoint_{version}.apk  # 版本物理归档
  │   └── latest.apk                       # 指向最新版（避免频繁改动外链）
  ├── ios/
  │   └── (预留结构)
  └── version.json                         # 全局版本清单
```

### 4.1 清单数据契约 (`version.json`)
```json
{
  "app": "inkpoint",
  "updatedAt": "2026-09-16T12:00:00Z",
  "desktop": {
    "version": "0.10.2",
    "releaseNotesUrl": "https://github.com/wmasfoe/md-editor/releases/tag/v0.10.2",
    "assets": {
      "macos_arm64": {
        "version": "0.10.2",
        "fileName": "Inkpoint_0.10.2_aarch64.dmg",
        "downloadUrl": "https://download.justdev.cn/inkpoint/desktop/macos/latest"
      },
      "windows_x64": {
        "version": "0.10.2",
        "fileName": "Inkpoint_0.10.2_x64-setup.exe",
        "downloadUrl": "https://download.justdev.cn/inkpoint/desktop/windows/latest"
      }
    }
  },
  "android": {
    "version": "0.1.0",
    "apk": {
      "version": "0.1.0",
      "fileName": "Inkpoint_0.1.0.apk",
      "downloadUrl": "https://download.justdev.cn/inkpoint/android/latest"
    }
  },
  "ios": {
    "version": "0.1.0",
    "testFlightUrl": "https://testflight.apple.com/join/placeholder"
  }
}
```

---

## 5. CI/CD 自动化流水线 (`.github/workflows/release-mobile.yml`)

1. **触发契约**：推送 `android-v*` 或 `mobile-v*` 标签时自动触发；
2. **渐进式签名**：
   - 若配置了 `secrets.ANDROID_KEYSTORE_BASE64`，自动解码并构建生产签名 APK；
   - 若未配置，自动构建自签名 APK（`assembleDebug`），开箱即用直接可在手机安装；
3. **自动化部署**：
   - 调用 `wrangler r2 object put` 自动上传 `Inkpoint_{version}.apk` 与 `latest.apk`；
   - 自动更新生成 `inkpoint/version.json` 并推送到 R2 根路径；
   - 上传 Actions Artifact 保留 30 天双重备份。

---

## 6. 官网联动设计 (`site`)

1. **`site/lib/site-links.ts`**：
   - 暴露 `DISTRIBUTION_DOMAIN = "download.justdev.cn"` 与 `DISTRIBUTION_URL`；
   - 提供 `buildAcceleratedDesktopUrl`、`buildAndroidApkUrl`、`buildVersionApiUrl` 等安全方法；
2. **`site/lib/downloads.ts`**：
   - 导出 `getMobileDownloadCatalog(locale)`，包含 Android APK 直链与 iOS TestFlight 渠道；
3. **`site/components/download-panel.tsx`**：
   - 桌面端下载按钮下方增加轻量优雅的移动端快捷接入横条，保证全终端访客一站式获取最新客户端。
