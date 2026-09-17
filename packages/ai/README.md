# @md-editor/ai

Inkpoint 模块化 AI 辅助写作引擎。负责与大语言模型（LLM）及本地小语言模型（SLM）通信、文档上下文紧凑蒸馏、流式补全解析及请求调度。

---

## 1. 架构定位与职责边界

根据 [能力边界设计原则](../../docs/agent/architecture/capability_boundary_design_principles.md)，`@md-editor/ai` 严格扮演“协议适配与推理接入层”：

- **只产出纯领域数据**：读取 AI 配置、向模型发起请求、解析流式响应，返回结构化的 `suggestion` 数据（如续写 `continuation` 或就地替换 `edit`）；
- **零编辑器 DOM 依赖**：绝不直接引入 CodeMirror 6 或修改光标 DOM。建议的 UI 幽灵文本预览、选区高亮与 Tab 键接受交互由 `@md-editor/renderer-codemirror` 全权负责；
- **独立可测**：单测仅需 Mock 模型网络响应，完全无需启动真实浏览器或加载编辑器渲染引擎。

---

## 2. 核心模块与功能

### 2.1 文档上下文蒸馏 (`document-context.ts`)
- **智能选区采样**：基于光标当前位置，智能提取上方紧邻段落、局部上下文与文档大纲层级；
- **Token 紧凑控制**：防止整篇万字长文无节制消耗模型 Context Window 与推理延迟，保证行内补全毫秒级响应。

### 2.2 多 Provider 与 SLM 协议 (`slm-protocol.ts` & `connector.ts`)
- 支持云端大模型：OpenAI、Anthropic Claude、DeepSeek；
- 支持本地优先小模型（SLM）：通过 Ollama 或本地推理后端运行的轻量级写作辅助模型。

### 2.3 元组 Diff 流式解析器 (`tuple-diff-parser.ts`)
- 极速解析模型返回的流式文本差异，转换为高精度的增量编辑指令。

### 2.4 请求防抖与生命周期调度器 (`request-scheduler.ts`)
- 具备自动请求防抖（Debounce）、光标移动时自动中止（AbortController）及竞态排队机制。

---

## 3. 主要 API 与使用

```typescript
import {
  RequestScheduler,
  distillDocumentContext,
  type AiCompletionRequest,
} from "@md-editor/ai";

// 1. 蒸馏光标周围上下文
const context = distillDocumentContext({
  fullMarkdown: "# 标题\n正文内容...",
  cursorOffset: 12,
  maxContextChars: 1000,
});

// 2. 发起建议请求调度
const scheduler = new RequestScheduler({
  onSuggestion: (suggestion) => {
    // 将纯 suggestion 注入到渲染层展现幽灵文本
    editorView.dispatch(setSuggestionEffect.of(suggestion));
  },
});
```

---

## 4. 开发与测试

```bash
pnpm test
pnpm typecheck
```
