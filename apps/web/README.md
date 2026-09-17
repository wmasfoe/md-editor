# @md-editor/web - Inkpoint 在线体验场 (Web Playground)

基于 [Vite 6](https://vitejs.dev/) + [React 19](https://react.dev/) 构建的 Inkpoint 官方纯前端在线体验应用。用户无需在本地安装任何桌面客户端，即可直接在浏览器中完整体验 Inkpoint 的所见即所得编辑、原生 MDX 组件与多文档目录树。

---

## 1. 架构特点

- **零安装直达**：纯静态 Web 应用（SPA），支持部署至 Vercel、Cloudflare Pages 或任何静态托管服务；
- **虚拟文件系统 (In-Memory FS)**：针对浏览器环境，基于 IndexedDB 实现多文档本地持久化存储，支持创建、删除、重命名文件与即时导出 Markdown 纯文本；
- **组件完整对齐**：完整接入 `@md-editor/renderer-codemirror`、`@md-editor/editor-ui` 及 `@md-editor/syntax-plugins`，保持与桌面端 100% 一致的编辑交互手感；
- **丰富示例模板**：内置 Markdown 语法速查、MDX 交互组件、Mermaid 图表与 LaTeX 数学公式示例供用户即刻体验。

---

## 2. 本地开发与构建

```bash
# 1. 启动 Web 端本地开发服务器 (默认端口 http://localhost:5173)
pnpm dev:web

# 2. 生产环境打包构建 (输出至 apps/web/dist)
pnpm build:web

# 3. 本地预览构建产物
pnpm --filter @md-editor/web preview

# 4. 执行单元测试与类型检查
pnpm --filter @md-editor/web test
pnpm --filter @md-editor/web typecheck
```

---

## 3. 部署上线

Web 在线版支持通过统一的发版指令部署至 Vercel 生产环境：

```bash
pnpm release:web
```
