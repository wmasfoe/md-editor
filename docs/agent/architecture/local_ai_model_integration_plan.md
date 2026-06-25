# 本地小模型接入方案

用途：记录 AI 本地小模型的产品边界、技术架构、模块拆分和分阶段落地计划。后续实现 `provider: "local"`、模型下载器、sidecar 推理进程、本地 AI 调用链路时先读本文件。

## 1. 目标与边界

目标是在 md-editor 内提供一个用户可直接启用的本地小模型能力：

1. 用户不需要安装 Ollama、Python、Conda、Node 服务或其他外部 runtime。
2. 用户在 App 设置页主动点击下载模型，模型文件保存到本机应用数据目录。
3. App 自己管理模型下载、校验、状态展示、删除和本地推理进程。
4. AI 续写和语法标点修复可以走本地模型，不把当前文章上下文发到远程 provider。
5. 远程 OpenAI-compatible provider 继续保留，作为另一种 provider，不影响本地模型链路。

非目标：

- 首版不做用户文章风格训练。
- 首版不做跨文档索引和检索增强。
- 首版不允许用户选择任意本地可执行文件或任意模型路径。
- 首版不把模型文件打进默认安装包，避免安装包体积膨胀。
- 首版不依赖 Ollama 作为后台服务。

这里的“专属小模型”在 v0.1 阶段指 md-editor 选择、固定、校验和调优过的写作小模型包，不代表已经基于用户历史文章完成个性化训练。用户风格学习应作为后续能力，并且仍然只走本地数据与本地模型。

## 2. 当前代码基础

当前代码已经有本地模型的占位接口：

- `packages/editor-core/src/index.ts` 已定义 `AiProviderType = "openai-compatible" | "deepseek" | "local"`。
- `AiLocalModelSettings` 已有 `enabled` 和 `status`。
- `apps/desktop/src/app/settings/app-settings.ts` 默认状态为 `localModel.enabled = false`、`status = "not-downloaded"`。
- `apps/desktop/src/components/SettingsDialog.tsx` 已有“本地模型”和“下载模型”区域，但下载按钮处于 disabled。
- `apps/desktop/src/app/ai/ai-completion.ts` 在 `provider === "local"` 时已经做 readiness 检查，但真正请求时仍抛出“本地模型续写还未接入”。

因此改造重点不是重新设计 AI UI，而是把 local provider 补成完整链路。

2026-06-25 进度：

- Rust 侧已接入本地模型状态查询、下载和删除命令。
- Desktop 设置页已能显示本地模型状态、进度和删除入口，并同步下载事件。
- `request_local_ai_continuation` 已接入 bundled `llama-server` sidecar runtime 和本机 `/v1/chat/completions` 转发。
- 默认模型下载源已配置为 `Qwen/Qwen2.5-0.5B-Instruct-GGUF` 的 `q4_k_m` 文件。
- 当前 runtime 先覆盖 macOS arm64 预编译包，其他平台还需要补齐对应 sidecar 资产。

## 3. 总体架构

建议采用三层结构：

```txt
React / editor-ui
  ├── 设置页：下载、启用、状态、删除
  ├── 编辑器：触发 AI suggestion
  └── ai-completion.ts：provider 路由与结果解析

Tauri Rust
  ├── local_ai_model.rs：模型 manifest、下载、校验、状态
  ├── local_ai_runtime.rs：sidecar 生命周期、端口、健康检查
  ├── local_ai_completion.rs：本地请求转发与响应清洗
  └── settings.rs：持久化本地模型配置

Bundled sidecar + downloaded model
  ├── llama-server sidecar：随 App 打包，按平台区分二进制
  └── GGUF model：用户主动下载到 app data dir
```

调用链：

```txt
用户触发 AI 写作建议
  -> requestAiContinuation(settings, context)
  -> provider === "local"
  -> invoke("request_local_ai_continuation", { context, options })
  -> Rust ensure_local_ai_ready()
  -> 如未启动，spawn llama-server sidecar
  -> HTTP POST 127.0.0.1:<port>/v1/chat/completions
  -> Rust 返回 content
  -> TypeScript 复用 parseAiWritingSuggestion / filterAiSuggestionBySettings
  -> Milkdown inline suggestion 展示
```

## 4. 技术选型

### 4.1 推理 runtime

首版建议使用 `llama.cpp` 的 server/sidecar 方式：

- 支持 GGUF 量化模型，适合小模型本地分发。
- 可使用 CPU，也可在 macOS 上利用 Metal 构建优化。
- server 提供 OpenAI-compatible `/v1/chat/completions`，可以复用现有 OpenAI-compatible prompt 和响应解析思路。
- 作为独立进程运行，崩溃时不直接拖垮 Tauri 主进程。
- Tauri 支持打包 external binaries 作为 sidecar。

暂不建议首版直接接入 `candle`、`ort`、`transformers` 或 Rust 原生推理库。它们可以减少本地 HTTP 进程，但首版会增加模型格式、tokenizer、chat template、跨平台性能和构建复杂度。先用 sidecar 打通闭环，后续如果需要更深集成再替换 runtime。

### 4.2 模型格式

首版使用单文件 GGUF：

- 文件容易下载、校验和迁移。
- 适配 llama.cpp。
- 可以发布多个量化档位，例如 `Q4_K_M` 和更小的 `Q4_0`。

### 4.3 模型候选

首选候选：

- `md-editor-writer-small-v1`
- 底座候选：Qwen3 1.7B Instruct / Chat 的 GGUF 量化版本
- 量化建议：优先 `Q4_K_M`，低配 fallback 可考虑 0.6B 或更低量化
- 上下文：首版运行参数可先设 4096 或 8192，避免内存占用过高
- 输出：继续沿用当前 `max_tokens: 220` 左右的小建议模式

选择理由：

- 中文能力和英文写作能力都相对均衡。
- 1B 级别模型在本地小模型里体积和效果较平衡。
- 适合当前 AI suggestion 的短上下文、短输出场景。

落地前必须确认：

- 具体 GGUF artifact 的许可证和再分发条件。
- 量化文件的来源、hash、大小和目标平台性能。
- macOS Intel、macOS Apple Silicon、Windows 的最低可用内存。

## 5. 模型 manifest

不要把下载 URL、hash 和版本散落在 UI 或 Rust 逻辑里。建议用一个模型 manifest 描述：

```json
{
  "schemaVersion": 1,
  "models": [
    {
      "id": "md-editor-writer-small-v1",
      "displayName": "md-editor Writer Small",
      "version": "2026.06.25",
      "runtime": "llama.cpp",
      "format": "gguf",
      "filename": "md-editor-writer-small-v1-q4_k_m.gguf",
      "downloadUrl": "https://download.example.com/models/md-editor-writer-small-v1-q4_k_m.gguf",
      "sizeBytes": 1200000000,
      "sha256": "<sha256>",
      "license": "Apache-2.0 or model-specific license",
      "recommendedContextSize": 4096,
      "recommendedMaxTokens": 220,
      "memoryTier": "standard"
    }
  ]
}
```

首版可以把 manifest 内置到 App；后续可支持从我们的服务拉取 manifest，但必须做签名或 hash 校验，避免下载源被替换后执行未验证模型。

## 6. 文件存储布局

模型和运行状态应放在应用数据目录，不放在项目目录或用户文档目录。

macOS 示例：

```txt
~/Library/Application Support/md-editor/
  settings.json
  ai/
    models/
      md-editor-writer-small-v1/
        manifest.json
        model.gguf
        model.gguf.sha256
        download.tmp
    runtime/
      state.json
```

约束：

- `download.tmp` 校验成功后再原子 rename 为 `model.gguf`。
- `manifest.json` 记录实际下载版本，避免后续 manifest 更新后误判。
- 删除模型只删除 `ai/models/<model-id>`，不能递归删除用户可配置路径。
- 不记录文章内容、prompt 或生成内容到持久日志。

## 7. 下载流程

用户操作：

1. 设置页选择 Provider：本地模型。
2. 点击“下载模型”。
3. UI 展示下载大小、进度、速度和剩余状态。
4. 下载完成后进入“校验中”。
5. SHA256 校验成功后状态变为“可用”。
6. 用户可启用本地模型并触发 AI 写作建议。

Rust command 建议：

```txt
get_local_ai_model_status(model_id) -> LocalAiModelStatus
download_local_ai_model(model_id) -> starts async download
cancel_local_ai_model_download(model_id)
delete_local_ai_model(model_id)
```

事件建议：

```txt
local-ai-model-progress
  modelId
  status: not-downloaded | downloading | verifying | available | failed
  downloadedBytes
  totalBytes
  error
```

下载实现要求：

- 只允许下载 manifest 中声明的 URL。
- 使用临时文件，支持失败后清理或继续。
- 校验 SHA256，不通过则删除临时文件并标记 failed。
- 下载状态不要只存在 React state，Rust 侧应能从文件系统恢复。
- 设置页重新打开时要能重新读取真实模型状态。

## 8. 本地推理进程

Rust 侧维护一个 `LocalAiRuntimeManager`：

```txt
LocalAiRuntimeManager
  current_model_id
  child_process
  port
  started_at
  last_used_at
```

启动策略：

1. 用户第一次触发本地 AI 请求时懒启动。
2. 随机选择本机可用端口，仅绑定 `127.0.0.1`。
3. 启动 sidecar：

```txt
llama-server
  --host 127.0.0.1
  --port <port>
  --model <app-data>/ai/models/<model-id>/model.gguf
  --ctx-size 4096
  --parallel 1
  --alias md-editor-writer-small-v1
```

4. 轮询 `/v1/models` 或健康接口确认模型可用。
5. 请求完成后更新 `last_used_at`。
6. 空闲一段时间后自动关闭，例如 5 到 10 分钟。
7. App 退出时关闭 sidecar。

失败处理：

- 模型文件不存在：返回“本地模型尚未下载”。
- sidecar 启动失败：返回“本地模型启动失败”，并记录 stderr 摘要。
- 健康检查超时：kill 子进程并返回“本地模型加载超时”。
- 生成超时：中断请求，必要时重启 runtime。

## 9. AI 请求与 prompt

本地模型首版不需要独立一套 UI，但建议独立一层请求函数：

```txt
requestAiContinuation()
  provider remote -> requestOpenAiCompatibleContinuation()
  provider local  -> requestLocalAiContinuation()
```

本地请求体可复用现有 JSON 输出协议：

```json
{
  "continuation": "string",
  "edit": {
    "original": "string",
    "replacement": "string",
    "reason": "string"
  }
}
```

本地模型更容易输出不稳定 JSON，因此建议增强约束：

- 加 `response_format: { "type": "json_object" }`，如果 runtime 支持。
- system prompt 更短，避免小模型被复杂指令稀释。
- 解析失败时保底只作为 `continuation`，沿用当前解析逻辑。
- 对 `edit.original` 继续做“必须存在于上下文”的校验，避免误改。

本地 prompt 重点：

- 保持原文语言和语气。
- 只输出 JSON。
- `edit` 只修复语法、标点、错别字和轻微表达。
- 不要重写整段，不要扩写选区之外内容。
- MDX / Markdown 语法边界不能被破坏。

## 10. 设置与 UI

现有设置页可以保留结构，但本地模型区域需要从占位变成可操作：

- Provider 选择“本地模型”时显示模型卡片。
- 状态：未下载、下载中、校验中、可用、失败。
- 按钮：
  - 未下载：下载模型
  - 下载中：取消
  - 失败：重试
  - 可用：删除模型 / 重新下载
- 展示模型大小和磁盘占用。
- 启用本地模型前，如果未下载，给出明确提示。
- 下载期间不要阻塞编辑器。

文案边界：

- “模型和推理都在本机运行。”
- “下载模型会占用约 X GB 磁盘空间。”
- “历史文章不会被上传到远程 provider。”
- 不要宣称“绝对隐私”或“永不联网”，因为下载模型本身需要联网。

## 11. 类型与持久化改造

建议扩展类型：

```ts
export type AiLocalModelStatus =
  | "not-downloaded"
  | "downloading"
  | "verifying"
  | "available"
  | "failed";

export interface AiLocalModelSettings {
  readonly enabled: boolean;
  readonly modelId: string;
  readonly version: string | null;
  readonly status: AiLocalModelStatus;
  readonly downloadedBytes: number;
  readonly totalBytes: number;
  readonly error: string | null;
}
```

注意：

- `status` 不应只依赖 settings.json；启动时要由 Rust 根据文件系统真实状态归一化。
- `downloadedBytes` 和 `totalBytes` 属于运行状态，可进入 React state，不一定全部写入 settings。
- `modelId` 默认值应来自内置 manifest。
- settings 里只保存用户选择和启用状态，模型实际可用性由 Rust 状态命令确认。

## 12. 安全与隐私

必须满足：

- sidecar 只绑定 `127.0.0.1`。
- 只允许启动 App 打包的 sidecar，不接受用户输入的可执行文件路径。
- sidecar 参数由 Rust 构造，动态参数要限制为模型路径、端口、上下文大小等安全值。
- 模型下载 URL 来自 manifest，且下载后必须 hash 校验。
- 不在日志里记录文章上下文、选区、prompt 或生成内容。
- 远程 provider 和本地 provider 的数据边界在 UI 上明确说明。
- 后续用户风格学习只能读取本地文件并在本机保存索引或画像。

## 13. 测试策略

TypeScript 单元测试：

- `normalizeAiSettings` 能兼容旧 settings，没有 `modelId` 时填默认值。
- `getAiCompletionReadiness` 覆盖未下载、下载中、可用、失败。
- `requestAiContinuation` 在 local provider 下调用本地 Tauri adapter，而不是 remote fetch。
- local provider 的错误文案不会吞掉真实失败原因。

Rust 单元测试：

- manifest 解析和 hash 校验。
- app data 模型路径只能落在允许目录下。
- 下载状态从文件系统恢复。
- 删除模型不会越界删除。
- runtime 参数构造不接受危险路径或任意参数注入。

集成测试：

- 用 mock sidecar 验证本地请求链路。
- 模拟下载成功、hash 失败、下载中断和重试。
- 模拟 sidecar 启动超时和生成超时。

手动验证：

- 设置页下载进度展示。
- 下载期间编辑器可继续使用。
- 本地模型可用后，显式 AI 写作建议能出现并可 Tab 接受。
- App 退出后 sidecar 进程被清理。
- 断网状态下，已下载模型仍可继续推理。

## 14. 分阶段落地

### Phase 1：模型状态与下载器

目标：设置页里的本地模型从占位变成真实下载和状态管理。

范围：

- 扩展 AI local settings 类型。
- 新增 manifest。
- Rust 实现模型状态、下载、校验、删除。
- UI 打开“下载模型”按钮。
- 不接入推理。

验收：

- 能下载模型到 app data dir。
- hash 校验成功后状态变为 available。
- 删除模型后状态回到 not-downloaded。
- 失败可重试。

### Phase 2：sidecar runtime

目标：App 能启动内置推理进程并完成健康检查。

范围：

- 引入 llama-server sidecar。
- 配置 Tauri externalBin 和 shell capability。
- Rust 管理进程生命周期、端口、健康检查、退出清理。
- 用 mock 或真实小模型验证 `/v1/models`。

验收：

- 不安装 Ollama 也能启动本地推理服务。
- 只监听 127.0.0.1。
- App 退出后进程清理。

### Phase 3：local provider 调用闭环

目标：AI 写作建议可以走本地模型。

范围：

- `requestAiContinuation` 的 local provider 改为 Tauri invoke。
- Rust 转发 `/v1/chat/completions`。
- 复用现有 suggestion 展示和接受逻辑。
- 增加本地模型 prompt 和 JSON 解析容错。

验收：

- provider 选本地模型后，显式 AI 建议可用。
- 断网但模型已下载时仍可生成。
- 未下载、加载失败、超时都有清晰提示。

### Phase 4：模型质量与性能优化

目标：让本地模型达到可用写作体验。

范围：

- 选择最终默认模型和 fallback 模型。
- 调整 prompt、上下文长度、max tokens、temperature。
- 支持空闲释放和预热提示。
- 收集非隐私的性能指标，例如加载耗时和生成耗时，不记录文本内容。

验收：

- 低配机器有明确 fallback 或禁用提示。
- 常见中文/英文 Markdown 写作场景可用。
- AI suggestion 不明显阻塞编辑器输入。

## 15. 未决问题

1. 默认模型最终选型：Qwen3 1.7B GGUF 是否满足体积、速度、许可证和中文写作质量要求。
2. 模型下载源：是否使用自己的 CDN，还是首期直接使用第三方模型仓库。
3. sidecar 构建策略：macOS Apple Silicon、macOS Intel、Windows 是否都进入首版。
4. 低配设备策略：是否提供更小模型，还是提示设备不满足推荐配置。
5. 模型更新策略：是否自动提示更新，还是只在设置页手动更新。
6. 是否需要提供“完全离线安装包”，把模型作为可选额外下载包而不是 App 内下载。

## 16. 参考资料

- Tauri sidecar / external binaries: https://v2.tauri.app/develop/sidecar/
- llama.cpp server OpenAI-compatible API: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Hugging Face Hub download concepts: https://huggingface.co/docs/huggingface_hub/guides/download
- Qwen3 1.7B model card: https://huggingface.co/Qwen/Qwen3-1.7B
