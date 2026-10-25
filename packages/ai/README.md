# @md-editor/ai

Inkpoint 模块化 AI 辅助写作引擎。基于整洁架构（Clean Architecture）与依赖倒置原则（DIP）设计，支持云端三大标准协议（OpenAI、Anthropic、Google Gemini）及自定义 Base URL（如 DeepSeek、Ollama），同时无缝集成端侧离线小语言模型（SLM，基于 RFC-004 v1.4.0 规范）。

---

## 1. 架构定位与整洁分层

根据整洁架构与 [能力边界设计原则](../../docs/agent/architecture/capability_boundary_design_principles.md)，`@md-editor/ai` 保持严格的由外向内单向依赖：

```
                    ┌────────────────────────┐
                    │       adapters/        │
                    │  (OpenAI / Anthropic / │
                    │   Google / LocalSlm)   │
                    └───────────┬────────────┘
                                │ (实现契约)
                                ▼
┌──────────────────┐   ┌─────────────────────┐
│       app/       │──>│       domain/       │
│  (WritingService │   │ (ModelClient / DIP  │
│   Harness / GEC) │   │  Settings / Types)  │
└──────────────────┘   └─────────────────────┘
```

- **`domain/`（纯领域层）**：
  - 定义 `ModelClient` 与 `ModelContext` 依赖倒置契约，与具体网络库、平台 IPC 完全解耦；
  - 提供多协议端点配置（`openai` | `anthropic` | `google` | `local`）、URL 快速预设（OpenAI、DeepSeek、Anthropic、Google Gemini、Ollama）以及旧版配置无损迁移。
- **`app/`（应用编排与 Harness 管道）**：
  - **Pre-Model Guardrails**（前置守卫）：跳过代码块、表格、公式、纯 URL 等无关语境；
  - **Prompt / GBNF 构造器**：构造纯文本 GEC 输入与 ChatML / FIM 模型上下文；
  - **Post-Model Sanitizers**：清洗 `<think>` 思考标签，处理光标前后重复边界重叠；
  - **Quad-Layer Tuple-Diff & Cloud Adaptive Locator**：支持精确切片、`±5` 容错窗口、全文子串定位与静默兜底；
  - **`AiWritingService`**：统一封装续写、语法润色、文档上下文提炼与连接测试。
- **`adapters/`（基础设施适配器层）**：
  - `OpenAIClient`：支持 OpenAI 官方、DeepSeek 及本地 Ollama（免强制 API Key）；
  - `AnthropicClient`：支持 Claude 3.5 / 4.5 Sonnet，自动携带浏览器直连请求头；
  - `GoogleClient`：支持 Gemini 2.5 Flash，支持 `systemInstruction` 与 `thinkingBudget: 0`；
  - `LocalSlmClient`：实现端侧双档位模型矩阵（Lite Qwen 3 0.6B + Standard Gemma 4 E2B），通过 `LocalInferenceBridge` 依赖倒置由宿主注入底层 IPC。

---

## 2. 跨端统一工厂用法

### 2.1 桌面端（启用本地模型桥接）

```typescript
import { createAiWritingService } from "@md-editor/ai";
import { desktopLocalAiBridge } from "./local-ai-model";

export const desktopAiService = createAiWritingService({
  allowLocal: true,
  localBridge: desktopLocalAiBridge,
});
```

### 2.2 Web 端 / uTools 插件端（纯云端多协议）

```typescript
import { createAiWritingService } from "@md-editor/ai";

export const webAiService = createAiWritingService({
  allowLocal: false,
});
```

---

## 3. 核心 API

### 3.1 续写与语法错别字审校

```typescript
// 1. 行内智能续写
const suggestion = await writingService.continueWriting(
  settings,
  {
    before: "今天天气真好，",
    after: "去公园散步。",
    mode: "wysiwyg",
  },
  { isGhostText: true },
);

// 2. 局部语法修复
const gecResult = await writingService.fixGrammar(
  settings,
  {
    before: "这里有一句",
    after: "的话。",
    selectedText: "错别字",
    mode: "wysiwyg",
  },
);

// 3. 连通性测试
const testResult = await writingService.testConnection(settings);
console.log(testResult.ok ? `连接成功: ${testResult.latencyMs}ms` : testResult.message);
```

---

## 4. 开发与验证

```bash
pnpm test
pnpm typecheck
```
