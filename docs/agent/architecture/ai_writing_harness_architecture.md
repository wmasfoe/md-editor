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
│   ├── harness-guardrails.ts # 前置守卫、后置净化与纠错锚点定位校准
│   ├── harness-prompts.ts    # Prompt 与 GBNF 构造器
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
- **Standard Gemma 4 续写**：基于 ChatML 消息提供文档大纲、局部前文与后文，返回续写正文；纠错元组 GBNF 只应用于 GEC，不应用于续写；
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

### 4.3 桌面宿主调用边界

- AI 包负责构建 System/User 消息、FIM Prompt 和 GBNF；Rust 不重新生成提示词或猜测编辑器上下文。
- Tauri 命令 `request_local_ai_continuation` 仅接收 `{ options: LocalInferenceRequest }`，不接收额外 `context`。
- 任务字段统一为 `task: gec | completion | distill`，Rust 使用同名枚举反序列化，不保留 `intent: editing | continuation` 旧映射。
- `messages` 与 `rawPrompt` 必须提供一种；Chat 使用 `max_tokens`，原生 `/completion` 使用 `n_predict`。
- LoRA 更新成功后才缓存任务；更新失败终止当次推理并保留可重试状态。无 LoRA 的 Standard 不访问适配器接口；未指定任务时使用基座。

### 4.4 发布清单与 RFC 示例的差异

2026-10-25 核对了 [v1.4.0 发布清单](https://github.com/wmasfoe/md-editor-models/releases/download/v1.4.0/manifest.json)。该清单与 RFC 示例不同，模型文件摘要必须取自实际发布清单，不能复制示例占位值：

- Lite 基座 `639,446,688` 字节，GEC LoRA `5,073,568` 字节；客户端内置摘要与下载体积已按发布清单校正。
- Standard 实际发布条目为 Q8_0、`5,048,352,864` 字节，下载源为 Hugging Face；RFC 描述的是 Q4_K_M、约 1.68 GB。当前默认 Q4_K_M 条目的摘要仍为占位值，需在量化规格确定后与真实产物统一。远程清单有效时会覆盖默认条目。
- [上游模型元数据](https://huggingface.co/api/models/unsloth/gemma-4-E2B-it-GGUF?blobs=true)在 revision `0314792d7f1f7e229411f620751375812bb9faf2` 已包含 Q4_K_M：`3,106,738,272` 字节，SHA256 为 `740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8`。因此 Q4_K_M 也需修正文档中的体积，并同步模型仓库的发布清单。

架构来源由用户指定为 [《10 分钟学会设计 Agent 架构》](https://www.youtube.com/watch?v=0QrSy9dKuH8)。本轮仅获取到视频元数据，未获取到字幕或正文，以上边界核对依据仓库契约与 RFC，不代表已完成视频逐项验收。

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
4. 桌面桥接与 Rust 共用 `apps/desktop/tests/fixtures/local-ai-inference-requests.json`，覆盖 GEC、Lite FIM、Standard Chat 续写与 Distill；Rust runtime 通过本地模拟 HTTP 服务验证 LoRA 开关、失败重试及任务缓存。
