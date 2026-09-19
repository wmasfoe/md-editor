# @md-editor/distribution-worker - 全球边缘分发网关

基于 [Cloudflare Workers](https://workers.cloudflare.com/) 构建的 Inkpoint 全球边缘下载网关与动态版本分发服务（绑定域名 `download.justdev.cn`）。

---

## 1. 核心架构与设计目标

为了保证全球用户下载客户端二进制（`.dmg`、`.exe`、`.AppImage`、`.deb`、`.apk`）时的极速体验，避免国内网络受 GitHub Release 访问限制及 API Rate Limit 影响，分发网关采用三级高可用容灾与边缘缓存架构：

- **极简语义化下载路由**：
  - `GET /inkpoint/macos/latest` → 自动重定向至最新 macOS 安装包（自动区分 Apple Silicon 与 Intel 架构）；
  - `GET /inkpoint/windows/latest` → 自动重定向至最新 Windows NSIS 安装包；
  - `GET /inkpoint/linux/latest` → 自动重定向至最新 Linux AppImage 安装包；
  - `GET /inkpoint/android/latest` → 自动重定向至最新 Android APK 安装包；
  - `GET /inkpoint/releases.json` → 获取聚合了 Desktop 与 Mobile 的全量历史版本清单。
- **三级高可用容灾 (Triple Fallback)**：
  1. **首选 R2 边缘存储**：直接代理 Cloudflare R2 对象存储中的二进制与 `releases.json`；
  2. **次选 GitHub Releases API**：实时拉取并格式化官方发布清单；
  3. **保底内置快照 (`fallback-releases.json`)**：构建时嵌入的静态版本快照，杜绝外部接口全线失效时的服务中断。
- **发布即生效 (Instant Edge Purge)**：CI 在上传新版发布产物后，通过 Cloudflare API 自动清除全网边缘缓存，实现新版本秒级全网下发。

---

## 2. 目录结构

```
infra/distribution-worker/
├── src/
│   ├── index.ts                # Worker 入口与事件监听
│   ├── router.ts               # 下载与元数据路由规则
│   └── fallback-releases.json  # 静态容灾版本快照
├── tests/                      # 路由与 Fallback 单测
├── wrangler.toml               # Cloudflare Worker 配置
└── package.json
```

---

## 3. 本地开发与部署

```bash
# 启动本地 Worker 模拟服务
pnpm dev:worker
# 或在当前目录下：
pnpm dev

# 运行单测
pnpm --filter @md-editor/distribution-worker test

# 部署至 Cloudflare Workers 生产环境
pnpm deploy:worker
```
