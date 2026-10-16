# @md-editor/site - Inkpoint 官方网站与下载门户

基于 [Next.js (App Router)](https://nextjs.org/) + [React 19](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/) 构建的 Inkpoint 官方展示网站与版本发布中心。

---

## 1. 核心功能

- **产品特性展示**：全方位呈现所见即所得、MDX 交互组件、AI 辅助写作、本地优先与极速原生性能；
- **多端分发门户 (Download Center)**：
  - 动态读取最新版本元数据，支持 macOS、Windows、Linux、Android 各端一键下载；
  - 自动识别访问者操作系统与设备架构，智能高亮推荐安装包；
  - 提供一键安装终端脚本（curl / irm）复制与 Homebrew 安装命令；
- **全量更新日志 (Changelog)**：
  - 聚合桌面端、移动端与 uTools 插件历史更新记录；
  - 完整支持中英文双语无缝切换；
- **增量静态再生 (ISR)**：结合 Cloudflare 边缘缓存刷新，既享受静态页面的毫秒级响应，又能在新版本发布时秒级获取最新下载链接。

---

## 2. 本地开发与构建

```bash
# 启动本地 Next.js 开发服务器 (默认端口 http://localhost:3000)
pnpm dev:site

# 生产环境打包构建
pnpm build:site

# 运行页面单元测试
pnpm --filter @md-editor/site test

# 执行类型检查
pnpm --filter @md-editor/site typecheck
```

---

## 3. 生产部署

支持通过统一脚本部署至生产服务器或 Vercel：

```bash
pnpm release:site
```
