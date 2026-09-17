# @md-editor/syntax-plugins

Inkpoint 的扩展 Markdown 语法插件集合。为 CodeMirror 6 编辑器注入数学公式（KaTeX）、流程图表（Mermaid）及自定义指令块（Directive Callout）等高级语法解析与实时视觉渲染能力。

---

## 1. 架构定位

`@md-editor/syntax-plugins` 基于 CodeMirror 6 的 ViewPlugin、StateField 及 Lezer 语法分析器扩展：
- 采用非侵入式的插件化设计，每个语法特性独立封装，可按需装配至编辑器；
- 遵循即时渲染与平稳降级原则，语法解析出错或网络库未就绪时展现优雅的错误边界，杜绝白屏或编辑器崩溃。

---

## 2. 核心插件模块

### 2.1 数学公式插件 (`src/math/`)
- **双模式解析**：
  - 行内公式：`$E = mc^2$`
  - 独立公式块：`$$\int_{-\infty}^{+\infty} e^{-x^2} dx = \sqrt{\pi}$$`
- **KaTeX 高性能渲染**：在离开编辑时实时投影为排版精美的数学符号；聚焦时平滑展开 LaTeX 源代码便于修改。
- **语法错误容灾**：当公式语法错误时，显示醒目但不破坏整体布局的警告标记。

### 2.2 Mermaid 图表插件 (`src/mermaid/`)
- **代码块语法拦截**：识别标有 `mermaid` 语言标记的代码块：
  ````markdown
  ```mermaid
  graph TD
    A[客户端] --> B[负载均衡]
    B --> C[应用服务器]
  ```
  ````
- **SVG 实时渲染**：异步调用 Mermaid 引擎生成矢量图表，内置缩放控制与主题色适配（自动匹配深色/浅色模式）。

### 2.3 自定义指令与提示块 (`src/directive/`)
- **Callout 语法支持**：支持 `:::note`、`:::tip`、`:::warning`、`:::caution`、`:::important` 等指令块；
- **视觉增强**：渲染带有主题指示图标、优雅左边框及彩色背景容器的视觉提示卡片。

---

## 3. 主要 API 与使用

```typescript
import { mathPlugin } from "@md-editor/syntax-plugins/math";
import { mermaidPlugin } from "@md-editor/syntax-plugins/mermaid";
import { directivePlugin } from "@md-editor/syntax-plugins/directive";
import { EditorState } from "@codemirror/state";

// 装配插件至 CodeMirror 扩展链
const state = EditorState.create({
  doc: "# 数学与图表示例\n\n$E=mc^2$\n",
  extensions: [
    mathPlugin(),
    mermaidPlugin(),
    directivePlugin(),
  ],
});
```

---

## 4. 开发与测试

```bash
# 运行单测用例
pnpm test

# 执行类型检查
pnpm typecheck
```
