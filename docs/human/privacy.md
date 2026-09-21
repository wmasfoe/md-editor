# Inkpoint 隐私说明

Inkpoint 是一款本地优先的 Markdown 编辑器。你的文档始终保存在自己的设备上，不会被上传到任何服务器。

以下是 Inkpoint 会产生网络请求的全部场景，以及每次请求会发送哪些信息。


## 一、应用内自动更新检查

Inkpoint 会定期检查是否有新版本可用（可在设置中关闭）。

- 请求地址：download.jiaqi.im（我们自己的 Cloudflare CDN），失败时回退到 GitHub
- 发送信息：当前 App 版本号
- 返回信息：最新版本号、更新包下载地址、更新日志
- 触发条件：应用启动时，或手动点击"检查更新"
- 如何关闭：设置 - 关闭"自动检查更新"

更新包下载完成后，由 Tauri 框架自动验证签名并安装，整个过程不发送任何额外数据。


## 二、错误上报

当应用发生崩溃或未处理的 JavaScript 异常时，会将错误信息发送到 Sentry（第三方错误监控平台）。默认开启，可在设置中关闭。

- 请求地址：sentry.io（Sentry 服务）
- 发送信息：
  - 错误类型和堆栈信息（用于定位代码问题）
  - 操作系统类型和版本（如 macOS 15.0、Windows 11）
  - App 版本号（如 0.10.4）
  - 设备架构（如 arm64、x86_64）
- 不发送的信息：
  - 你的文档内容
  - IP 地址（已关闭 Sentry 的 IP 采集）
  - 文件名或文件路径
  - 任何可识别个人身份的信息
- 如何关闭：设置 - 取消勾选"启用匿名错误上报"


## 三、安装包下载

当你从官网或安装脚本下载 Inkpoint 时，下载请求会经过我们的 CDN（download.jiaqi.im）。

- 请求地址：download.jiaqi.im（Cloudflare Worker + R2）
- 记录信息：
  - 下载的文件名和版本号
  - 平台类型（从文件名推断，如 macOS ARM64、Windows x64）
  - 下载来源（官网点击、应用内更新、终端脚本、直接访问）
  - 请求来源国家（由 Cloudflare 根据 IP 自动识别的国家代码，如 CN、US）
  - User-Agent（浏览器或终端标识）
- 不记录的信息：
  - 客户端 IP 地址
  - Cookie 或任何会话标识
  - 任何可关联到具体用户的数据

防刷量机制：同一 IP 同一天对同一版本的下载只记录一次。实现方式是对客户端 IP 做 HMAC-SHA256 哈希（加盐），只存储哈希值，不存储原始 IP。哈希值每天自动过期。


## 四、官网页面访问

访问 inkpoint 官网（editor.justdev.cn 或 editor.jiaqi.im）时，由 Vercel 托管，会记录标准的访问日志。这部分由 Vercel 平台管理，不在 Inkpoint 应用范围内。


## 五、其他说明

- Inkpoint 不会读取或上传你的文档、笔记、图片等任何本地文件
- Inkpoint 不会追踪你的编辑行为、打开记录或搜索历史
- Inkpoint 不包含广告、用户追踪脚本或行为分析 SDK
- MDX 组件在本地沙箱中渲染，不会向外部发送请求
- AI 功能（如启用）的请求地址取决于你配置的 AI 服务提供商，不在本文讨论范围内


## 六、数据存储位置

- 你的文档：本地设备
- 错误上报数据：Sentry 服务器（美国）
- 下载统计数据：Cloudflare D1（全球边缘数据库，仅含聚合统计，不含个人数据）
- 安装包文件：Cloudflare R2 对象存储 + GitHub Releases


## 七、联系我们

如果你对 Inkpoint 的隐私实践有任何疑问，可以在 GitHub 仓库提交 issue：
https://github.com/wmasfoe/md-editor/issues
