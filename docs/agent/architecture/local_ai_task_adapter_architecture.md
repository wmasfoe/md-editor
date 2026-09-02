# 本地 AI 任务、模型档位与 Adapter 架构方案

> 状态：方案确认，代码尚未实现
>
> 适用范围：当前阶段的本地 AI 修复、续写、文档总结与风格分析。端云协作只作为未来扩展方向保留，不作为本阶段实现前提。
>
> 关联仓库：`md-editor` 客户端与 `md-editor-models` 微调/发布仓库

## 1. 已确认的产品约束

1. 用户界面只展示逻辑模型档位，例如 `Lite`、`Standard`。
2. 一个 App 会话当前只启用一个本地模型档位；本阶段不考虑 Lite 与 Standard 同时运行。
3. 一个逻辑模型档位可以包含一个 Base Model 与多个任务 Adapter。
4. Adapter 对用户隐藏，由 App 根据任务自动选择。
5. 业务调用方不传 GGUF 文件名、文件路径或具体 Adapter 版本，只提出逻辑任务。
6. 当前阶段支持本地 AI 修复建议、AI 续写，并继续演进文档总结等分析任务。
7. 本次先不做内存预加载多个 Adapter；磁盘文件缓存与版本管理必须支持。
8. 不同任务不共享模型 KV Cache；分析结果可以进入共享的应用层 Analysis Store。
9. 同一任务作用域只保留最新有效请求，旧请求的结果不得写回编辑器。

## 2. 当前代码现状

### 2.1 已有能力

当前代码已经存在部分 Model 层：

- `apps/desktop/src-tauri/src/local_ai_model.rs`
  - 管理 Lite / Standard / Pro 模型档位
  - 处理远程 manifest、下载、校验、状态与删除
  - 当前粒度是“一个 modelId 对应一个完整 GGUF”
- `apps/desktop/src-tauri/src/local_ai_runtime.rs`
  - 管理 llama-server 子进程
  - 当前 Runtime 只持有一个进程和一个 modelId
  - 当前启动参数使用 `--parallel 1`
- `apps/desktop/src-tauri/src/local_ai_completion.rs`
  - 接收本地推理命令
  - 根据 `modelId` 查找可用模型
  - 组装 prompt、grammar、停止词和推理参数
- `packages/ai/src/completion.ts`
  - 按 `intent` 区分 continuation、editing、distill
  - 已支持 `documentContext`、`previousSummary`、`profile` 注入
  - 已通过 Tauri 注入点调用本地模型
- `packages/ai/src/document-context.ts` 与 `slm-protocol.ts`
  - 已存在文档渐进式提炼和内存上下文管理雏形
  - 已存在任务控制符、上下文、用户风格和前次摘要的 prompt 组织

### 2.2 尚未具备的能力

当前还没有以下完整层次：

```text
逻辑 AI Task
    ↓
当前 Model Tier
    ↓
Capability Resolver
    ↓
Base + Adapter + Prompt + Grammar + 推理参数
    ↓
Local AI Runtime
    ↓
llama-server
```

目前 `packages/ai/src/completion.ts` 仍然把 `settings.localModel.modelId` 传给底层，业务调用方间接知道模型 ID；Runtime 只启动完整 GGUF，尚未加载或调度 Adapter。

## 3. 目标分层

### 3.1 Model Tier

用户可见的逻辑档位：

```text
Lite
Standard
```

本阶段一次只激活一个 Tier。Tier 不是单个文件，而是一组可用的 Base 与任务能力清单。

### 3.2 AI Task

业务层使用稳定的逻辑任务枚举，不直接使用 Adapter 名称：

```text
Gec
Completion
Distill
StyleAnalysis
```

任务表示“要做什么”，不表示“用哪个文件”。

### 3.3 Adapter

Adapter 表示某个 Base 上针对某种能力训练的增量参数，例如：

```text
qwen3-0.6b-gec
qwen3-0.6b-completion
qwen3-0.6b-distill
```

同一个任务在不同 Tier 下可以解析到不同 Adapter：

```text
Lite + Gec     → qwen3-0.6b-gec
Standard + Gec → qwen3-1.5b-gec
```

### 3.4 Capability Profile

Resolver 最终返回一个完整执行配置，而不是只有 Adapter 路径：

```text
CapabilityProfile
├── task
├── base model
├── adapter
├── prompt template
├── grammar
├── special tokens
├── context limit
├── max output tokens
├── temperature
└── cache policy
```

这可以防止“选中了 GEC Adapter 却使用 Completion Prompt 或错误 Grammar”。

## 4. Manifest 目标模型

当前 manifest 的 `models[]` 可以演进为“一个 Tier 下的 Base + capabilities”：

```json
{
  "schemaVersion": 2,
  "version": "v1.2.0",
  "models": [
    {
      "modelId": "md-editor-writer-lite",
      "tier": "lite",
      "displayName": "Lite",
      "base": {
        "id": "qwen3-0.6b-base",
        "version": "v1.2.0",
        "filename": "qwen3-0.6b-base.gguf",
        "sizeBytes": 0,
        "sha256": "...",
        "downloadUrl": "..."
      },
      "capabilities": {
        "gec": {
          "adapterId": "qwen3-0.6b-gec",
          "version": "v1.2.0",
          "filename": "qwen3-0.6b-gec-v1.2.0.gguf",
          "sizeBytes": 0,
          "sha256": "...",
          "downloadUrl": "...",
          "promptTemplate": "gec-v2",
          "grammar": "tuple-diff"
        },
        "completion": null,
        "distill": null,
        "style-analysis": null
      }
    }
  ]
}
```

数值大小和 SHA256 必须由发布脚本实际产物计算，不能手填。

Adapter 必须绑定 Base：

```text
adapter.baseModelId == base.id
adapter.baseSha256 == base.sha256
```

不兼容时必须拒绝执行，不能静默回退到其他 Adapter。

## 5. 请求 ID 与结果有效性

每个请求生成全局唯一 `requestId`，同时携带：

```text
requestId
 taskKind
documentId
documentRevision
anchor / selection
```

有效请求不建议只按全局任务类型保存，而应按作用域保存：

```text
(documentId, taskKind)
```

未来涉及多个编辑位置时扩展为：

```text
(workspaceId, documentId, taskKind, anchor)
```

同一作用域的新请求会替换旧请求的有效 ID。响应返回时必须同时检查：

1. `requestId` 仍是当前有效 ID；
2. `documentRevision` 仍匹配；
3. `documentId` 与编辑器实例仍匹配；
4. Completion 的 anchor / selection 仍匹配。

检查失败就丢弃响应，不更新编辑器。

## 6. 请求调度

建议保留三层优先级：

```text
Urgent       用户主动触发
Normal       编辑过程中的重要自动任务
Background   摘要、风格、术语等低优先级分析
```

调度器至少需要支持：

```text
enqueue
cancel
replace
coalesce
expire
```

任务策略：

| 任务 | 推荐策略 |
|---|---|
| Completion | 同一文档、同一 anchor 只保留最新请求 |
| GEC | 同一文档只保留最新 revision |
| Distill | 相同文档 revision 的重复任务合并 |
| StyleAnalysis | 可去重并放入 Background |
| 用户主动操作 | 进入 Urgent，结果未过期时优先完成 |

当前可以保持 `maxConcurrency = 1`，但业务接口不能写死为单任务模型。未来可让 Runtime 使用 llama-server 多 slot。

同类型新请求通常取消旧请求；不同类型任务是否并行由调度器决定，而不是由业务调用方各自实现。

## 7. 并行与 KV Cache

llama.cpp 支持多 slot 和 continuous batching，但当前客户端启动参数是 `--parallel 1`，因此当前实际行为是串行。

未来开启多 slot 后：

```text
Slot 0：GEC
Slot 1：Distill
```

仍需保证每个请求拥有独立的 requestId、上下文和 KV Cache。不同 Adapter 不直接共享 KV Cache，因为 Adapter 改变了模型计算路径。

本阶段推荐：

```text
磁盘：缓存所有已下载 Base / Adapter
内存：只激活当前任务 Adapter
KV：按请求隔离，不跨 Adapter 复用
```

内存预加载多个 Adapter 作为后续优化方向记录，但本阶段不实现。

## 8. 分析结果共享

文档总结和风格分析的结果进入应用层 Analysis Store，而不是直接共享模型 KV Cache。

建议保存：

```text
DocumentSummary
DocumentOutline
UserStyleProfile
ProtectedTerms
```

每条结果需要关联：

```text
documentId / workspaceId
sourceRevision
analysisVersion
modelVersion
createdAt
confidence
```

不同任务可以共享分析结果，但通过各自的 Context Builder 选择字段：

- GEC：当前句子、前后局部文本、保护词表、必要的格式规则；不默认注入完整文档摘要。
- Completion：当前段落、前后文窗口、文档摘要、大纲、重要术语、用户风格。
- Distill：文档内容、章节结构和已有摘要。
- StyleAnalysis：用户允许分析的历史或行为特征，输出结构化风格配置。

三种机制的职责：

```text
特殊 Token：任务路由与稳定协议标记
Prompt：动态文档、摘要、风格与术语上下文
Analysis Store：保存可复用的分析结果
模型 KV Cache：单次推理内部状态，不跨任务共享
```

## 9. App、Runtime、llama-server 边界

```text
App / AI Orchestrator
  判断任务、生成 requestId、管理取消与优先级

Model / Capability Layer
  根据当前 Tier 和 manifest 解析 Base、Adapter 与执行配置

Local AI Runtime
  管理 llama-server 生命周期、Adapter 加载/请求配置、健康状态

llama-server
  执行指定 Base + Adapter 的推理
```

llama-server 不负责根据文本猜测任务，也不负责判断结果是否还能写回编辑器。

## 10. 当前确认的支持矩阵

| 能力 | 当前代码 | 目标方案 | 备注 |
|---|---|---|---|
| 用户只选择一个 Lite/Standard | 部分支持 | 保持 | 当前已有 `localModel.modelId` |
| Model manifest 下载/校验 | 支持 | 扩展 | 当前按完整 GGUF 管理 |
| 本地 GEC | 支持 | 改用 GEC Adapter | 当前使用 `intent=editing` + GBNF |
| 本地 Completion | 支持 | 改用 Completion Adapter | 当前使用 `intent=continuation` |
| 文档总结 | 支持雏形 | 使用 Distill Adapter | 已有渐进式提炼与 `previousSummary` |
| 用户风格分析 | 类型/Prompt 雏形 | 增加独立任务和结果存储 | 当前 `UserStyleProfile` 较简单 |
| Adapter 文件磁盘缓存 | 不支持 | 必须支持 | manifest 与下载层需扩展 |
| 内存预加载多个 Adapter | 不支持 | 本阶段不实现 | 文档预留 |
| 多 slot 并行 | 当前关闭 | 后续可选 | 当前 Runtime 固定 `--parallel 1` |
| 请求 ID / 过期结果丢弃 | AbortSignal 局部支持 | 增加统一请求协议 | 当前缺少跨层 requestId/revision 门禁 |
| 任务优先级队列 | 未发现 | 新增 | 需要放在 App AI Orchestrator |
| 不同任务独立 KV Cache | llama-server 请求天然有独立上下文，但 App 未建模 | 明确约束 | 不跨 Adapter 复用 |
| 端云协作 | 非本阶段 | 仅保留扩展点 | 不影响当前本地实现 |

## 11. 实施顺序

1. 先在 `md-editor-models` 训练并发布 Qwen3-0.6B Lite 的基座/Adapter 产物，建立真实 manifest。
2. 在 `md-editor` 新建 `feature/` 分支，先引入逻辑任务枚举和 Model/Capability 层，不改变用户 UI。
3. 扩展本地模型下载状态，使一个逻辑 Lite 包含 Base 与多个 Adapter。
4. Runtime 先保持单进程、单活动任务、`--parallel 1`，打通 Adapter 执行。
5. 增加 requestId、documentRevision 和结果有效性检查。
6. 增加 Urgent / Normal / Background 调度器及同作用域合并/取消。
7. 将文档总结、风格分析结果统一收进 Analysis Store。
8. 真实端侧验证稳定后，再评估多 slot、per-request Adapter 和内存预加载。

端云协作未来可以复用 `AiTaskKind`、Capability Profile 和 Analysis Store，但不作为本阶段实现依赖。
