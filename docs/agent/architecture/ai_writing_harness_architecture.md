# AI 写作服务整洁架构与 App Harness 编排规范 (AI Writing Harness Architecture)

本文档记录 `@md-editor/ai` 采用整洁架构（Clean Architecture）、依赖倒置原则（Dependency Inversion Principle）与 App Harness 编排管道的技术设计，以及与 RFC-004 (v1.4.0) 客户端端侧模型对接的落地实现。

---

## 1. 设计动机与第一性原理

在历史实现中，AI 模块存在以下痛点：
1. **协议绑定严重**：底层与 OpenAI-compatible 和 DeepSeek 深度耦合，无法天然扩展至 Anthropic Claude、Google Gemini 等现代大模型标准协议；
2. **缺乏 Harness 防护**：直接将光标上下文暴露给模型，容易产生 `<think>` 思考标签污染输出、行首重复拼接、代码块/表格/LaTeX 误触发以及模型输出索引漂移等缺陷；
3. **平台依赖倒置不足**：部分模块直接假设了浏览器环境或桌面 Tauri 环境，导致 Web、uTools 与桌面端出现重复造轮子或类型不一致。

基于以上问题，我们依照整洁架构（Clean Architecture）进行彻底重构：
- 将模型通信抽象为纯粹的领域契约 `ModelClient`；
- 所有 Prompt 构造、前置拦截（Guardrails）、输出净化（Sanitizers）与定位校准（Locator）收敛在平台无关的 `app/` 管道层；
- 外部平台（桌面端 Tauri Rust 后端、浏览器网络层）作为适配器通过依赖倒置向内注入。

---

## 2. 整洁分层与目录结构

```
packages/ai/src/
├── domain/                  # 纯领域层（零外部依赖，单向向内）
│   ├── types.ts             # 领域实体：AiSettings, AiTaskKind, GecEditTuple, DiffItem
│   ├── model-client.ts      # 依赖倒置契约：ModelClient, ModelContext, LocalInferenceBridge
│   └── settings.ts          # 多协议端点、预设配置、历史数据迁移与准备度校验
├── app/                     # 写作应用编排与 Harness 管道
│   ├── harness-guardrails.ts # 前置守卫：shouldSkipAutoGec、纯文本 GEC 规范化
│   ├── harness-prompts.ts    # Prompt 与 GBNF 构造器、后置净化与四重锚点定位校准
│   ├── document-context.ts   # 文档宏观上下文渐进式提炼与大纲提取
│   ├── request-scheduler.ts  # 请求并发调度与防抖抢占
│   ├── cache.ts              # LRU 缓存
│   └── writing-service.ts    # 统一应用服务外观 (AiWritingService)
├── adapters/                # 基础设施适配器层（实现 domain 契约）
│   ├── http-transport.ts     # 跨端通用 HTTP POST 封装
│   ├── openai-client.ts      # OpenAI / DeepSeek / Ollama 协议适配
│   ├── anthropic-client.ts   # Anthropic Claude 协议适配（含直接浏览器请求头）
│   ├── google-client.ts      # Google Gemini 协议适配（thinkingBudget: 0）
│   ├── local-slm-client.ts   # RFC-004 双档位端侧模型适配（ChatML / FIM）
│   └── client-factory.ts     # 适配器工厂 (createModelClient)
└── index.ts                 # 组合根与统一对外暴露入口 (createAiWritingService)
```

---

## 3. App Harness 核心工作流

### 3.1 前置守卫 (Pre-Model Guardrails)
在 `shouldSkipAutoGec` 中执行确定性检测：
- 光标处于未闭合的 Markdown 代码围栏内部；
- 光标位于 LaTeX 数学公式块或行内未闭合 `$` 内部；
- 目标行为表格对齐分割线、纯分割线、Markdown 纯 URL 或 HTML 注释；
- 目标行正在输入列表符或标点且有效文本过短。

### 3.2 构造规范 (Prompt Harness)
- **GEC 语法纠错**：严格遵照纯文本协议，User Prompt 仅传入纯 `${targetText}`，无额外标签前缀；
- **Standard Gemma 4 续写**：基于 ChatML 结构化多轮消息，提供全局文档大纲、局部前文与后文，配合 GBNF 语法围栏输出；
- **Lite Qwen 3 续写**：基于超低延迟原生 `/completion` FIM 模式，直通模型补全。

### 3.3 后置净化与四重锚点定位 (Post-Model & Quad-Layer Defense)
模型返回文本后依次执行：
1. **思考标签清洗**：彻底剔除 `<think>...</think>` 及 `<|thought|>...<|endofthought|>` 思考内容；
2. **前后边界去重**：剥离模型续写输出与光标前文、后文重叠的冗余边界字符；
3. **四重锚点防御 (TC-1 ~ TC-5)**：
   - **Layer 1**：精确 UTF-16 偏移切片匹配；
   - **Layer 2**：`±5` 字符局部滑动容错窗口搜索；
   - **Layer 3**：原句全文子串锚点兜底搜索；
   - **Layer 4**：全部失配时静默安全丢弃（Silent Drop），绝不在编辑器中产生错位修改。

---

## 4. RFC-004 (v1.4.0) 客户端落地规格

### 4.1 双档位端侧模型规格
- **Lite (`md-editor-writer-lite`)**：
  - 基座：Qwen 3 0.6B Q8_0（`base.gguf`）；
  - Adapter：单个 GEC LoRA（`gec.gguf`）；
  - 续写走裸 `/completion` 原生 FIM，LoRA scale 置 0.0；语法修复走单个 LoRA scale 1.0。
- **Standard (`md-editor-writer-standard`)**：
  - 基座：Google Gemma 4 E2B Q4_K_M（`base.gguf`）；
  - Adapter：0 LoRA（原生强基座能力）；
  - 续写与语法修复统一走 `/v1/chat/completions` 标准 ChatML。

### 4.2 思考模式强制禁用
- `llama-server` 进程启动参数：`--jinja`, `--reasoning-budget 0`, `--n-gpu-layers 99`；
- `/v1/chat/completions` 请求载荷强制包含：`"chat_template_kwargs": { "enable_thinking": false }`。

---

## 5. 跨端整合矩阵

| 宿主平台 | 运行模式 | 本地模型 | 支持协议 | 注入桥接 |
| :--- | :--- | :--- | :--- | :--- |
| **Desktop** | 原生 Tauri | ✅ Lite / Standard | OpenAI / Anthropic / Google / 本地 | `desktopLocalAiBridge` (Tauri IPC) |
| **Web** | 浏览器 / Playground | ❌ 禁用 | OpenAI / Anthropic / Google | 无 (纯 HTTP Fetch) |
| **uTools** | 插件沙箱 | ❌ 禁用 | OpenAI / Anthropic / Google | 无 (纯 HTTP Fetch + 免责声明) |

---

## 6. 验证与测试规范

每次变更必须保证：
1. `packages/ai/tests/ai-boundary.test.ts` 零外向依赖架构检查 100% 通过；
2. `packages/ai/tests/tuple-diff-parser.test.ts` RFC-004 TC-1 ~ TC-5 测试全部通过；
3. 各应用端 (`apps/desktop`, `apps/web`, `apps/utools`) 单测与类型检查 100% 通过。
