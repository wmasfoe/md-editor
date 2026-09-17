# @md-editor/markdown-fidelity

Markdown 格式高度保真转换与 AST 双向映射引擎。确保文档在所见即所得渲染、模式切换与持久化存储过程中，100% 保持原始文本结构与特殊元数据，杜绝格式意外破坏。

---

## 1. 架构定位

在富文本与 Markdown 双向转换中，许多编辑器存在“保存即格式被格式化工具洗白”的技术痛点（如 Frontmatter 丢失、空白行被合并、自定义 HTML 属性被剥离）。

`@md-editor/markdown-fidelity` 专为**极致格式保真（High Fidelity）**而设计：
- **无损往返 (Lossless Round-Trip)**：读取、编辑、保存前后保持字符级保真；
- **元数据优先**：准确识别并保护 YAML Frontmatter、原生 HTML 注释与内联标签；
- **大纲与资产索引**：提供高效的纯函数大纲目录生成器与跨平台图片资源路径映射器。

---

## 2. 核心功能

### 2.1 Frontmatter 边界感知与保护 (`findFrontmatterSourceRange`)
- 严格解析位于文件头部的 `---` 声明区段，支持检测闭合状态（`closed` 或 `unterminated`）；
- 锁定精确的字符位置索引（`contentRange` 与 `fullRange`），防止渲染层将其误作为普通 Markdown 水平分割线解析。

### 2.2 标题大纲提取 (`extractHeadingOutline`)
- 纯函数极速解析 H1 ~ H6 标题，生成大纲数据结构（包含标题级别、纯文本、行号与唯一标识）；
- 供 `@md-editor/editor-ui` 的 `OutlinePanel` 消费，零外部 DOM 依赖。

### 2.3 资产路径解析器 (`resolveMarkdownImageSrc`)
- 智能识别相对路径（`./assets/pic.png`）、绝对路径与网络 URL；
- 在 Tauri 桌面环境下，通过安全资产协议适配本地文件系统协议（`convertFileSrc`），而在序列化回 Markdown 时恢复标准相对路径。

---

## 3. 主要 API 与使用

```typescript
import {
  findFrontmatterSourceRange,
  extractHeadingOutline,
  type FrontmatterSourceRange,
} from "@md-editor/markdown-fidelity";

const content = `---
title: 我的文章
date: 2026-09-17
---

# 一级标题
## 二级标题
`;

// 1. 提取 Frontmatter 范围
const fmRange = findFrontmatterSourceRange(content);
if (fmRange) {
  console.log("YAML 内容:", fmRange.content);
}

// 2. 提取大纲
const headings = extractHeadingOutline(content);
// [ { level: 1, text: "一级标题", line: 6 }, { level: 2, text: "二级标题", line: 7 } ]
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
```
