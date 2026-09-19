# @md-editor/compiler

极速、零 DOM、零 CodeMirror 依赖的 Headless 静态 Markdown 编译与 HTML 渲染器。专为 macOS QuickLook 原生预览扩展、Cloudflare Worker 边缘渲染、静态页面构建与大模型 Token 解析而设计。

---

## 1. 架构定位

传统的富文本与 Markdown 渲染强依赖浏览器 DOM 环境或 CodeMirror 6 实例。在下述场景中，这些依赖会导致沉重的初始化开销或在无 DOM 环境中直接报错：
- **macOS QuickLook 预览插件**：在 Finder 中按空格键即时预览 `.md` / `.mdx` 文件，要求毫秒级启动与极低内存；
- **边缘计算 (Cloudflare Worker / Vercel Edge)**：无 Node.js 全量 DOM 模拟库（如 JSDOM）；
- **后台批量文档索引与 Token 提取**。

`@md-editor/compiler` 采用 100% 纯逻辑与流式编译设计，能在任何纯 JavaScript 引擎（包括 JavaScriptCore、V8、Node.js）中高效执行。

---

## 2. 核心功能

### 2.1 结构化 Token 解析器 (`compileToTokens`)
- 将 Markdown 源文本解析为轻量直观的 `StaticToken[]` 树结构；
- 自动提取首个 H1 标题或 YAML Frontmatter 元数据；
- 支持第三方做语义分析、目录索引或大模型结构化消费。

### 2.2 静态 HTML 渲染纯函数 (`renderStaticHtml`)
- 纯纯函数（0 副作用），支持高亮代码块（基于 `highlight.js`）及数学公式（基于 `katex`）；
- 输出结构紧凑、样式隔离的 HTML 片段。

### 2.3 独立完整文档模板 (`createStaticDocumentHtml`)
- 内置针对 Apple 视网膜屏幕优化的现代 Typography 排版样式（系统字体、代码字体、表格边框、深浅色自适应）；
- 生成包含完整 `<head>`、CSS 样式与 Math 样式的独立单页 HTML，供 QuickLook 或离线阅读直接加载。

---

## 3. 主要 API 与使用

```typescript
import {
  renderStaticHtml,
  createStaticDocumentHtml,
  compileToTokens,
} from "@md-editor/compiler";

const md = `
# 标题
这是一段正文，包含数学公式 $E=mc^2$。

\`\`\`typescript
const greet = "Hello Inkpoint";
\`\`\`
`;

// 1. 编译为结构化 Token 树
const tokens = compileToTokens(md);

// 2. 渲染为 HTML 片段
const { html, title } = renderStaticHtml(md);

// 3. 生成可供 macOS QuickLook 使用的自包含 HTML 文档
const fullHtmlDoc = createStaticDocumentHtml({
  markdown: md,
  theme: "auto",
});
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
pnpm build
```
