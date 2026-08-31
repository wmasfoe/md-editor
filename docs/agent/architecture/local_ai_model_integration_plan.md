# 本地小模型接入方案

用途：记录 AI 本地小模型的产品边界、技术架构、多档位规划、硬件检测、模型生命周期管理（下载/更新/删除）、GBNF 结构化约束解码及后续二次开发微调方案。后续实现 `provider: "local"`、模型管理器、sidecar 推理进程、本地 AI 调用链路时先读本文件。

## 1. 目标与边界

目标是在 md-editor 内提供一个用户可直接启用的本地小模型能力：

1. 用户不需要安装 Ollama、Python、Conda、Node 服务或其他外部 runtime。
2. 用户在 App 设置页选择适合自己电脑配置的模型档位（Lite / Standard / Pro），主动点击下载，模型文件保存到本机应用数据目录。
3. App 自动检测本机硬件配置（CPU 架构与物理内存），智能给出推荐档位（如 16GB 推荐 Standard 1.5B，8GB 推荐 Lite 0.5B）。
4. App 自身管理各模型的下载、SHA256 校验、版本比对、在线更新、状态展示、删除和本地推理进程生命周期。
5. AI 续写和语法标点修复走本地模型，不把当前文章上下文发到远程 provider，支持完全离线工作。
6. 推理层通过 GBNF / 严格 JSON Schema 采样约束，确保小模型 100% 输出符合格式要求的 JSON，杜绝输出代码围栏或多余闲聊。
7. 远程 OpenAI-compatible / DeepSeek provider 继续保留，作为可切换的 provider。

非目标：

- 不把模型文件打进默认安装包，避免安装包体积膨胀。
- 首版不依赖 Ollama 或任何全局守护进程。
- 模型微调训练工程不放在客户端 Monorepo 仓库中，而是建立独立仓库。

---

## 2. 总体架构与数据流

```txt
React / editor-ui (Claude & Open Design 规范)
  ├── 系统硬件概览卡片 (get_system_specs 硬件检测 + 智能推荐徽标)
  ├── 三档位模型卡片网格 (Lite 0.5B / Standard 1.5B / Pro 3B 占位)
  ├── 独立模型生命周期操作 (下载 / 更新模型 / 删除模型 / 取消下载)
  └── 编辑器 Inline Ghost Text / Diff Widget

@md-editor/ai
  ├── provider 路由与 readiness 检查
  ├── 多模型 Manifest 与设置类型归一化
  └── 请求体构造与建议结果解析

Tauri Rust
  ├── system_info.rs：CPU 架构、核心数与物理内存大小采集
  ├── local_ai_model.rs：多模型 Manifest、版本检测 (has_update)、下载/更新、校验、删除
  ├── local_ai_runtime.rs：llama-server sidecar 生命周期、端口管理、空闲释放、删除时优雅终止
  └── local_ai_completion.rs：GBNF / 严格 JSON Schema 请求构造与响应解析

Bundled sidecar + downloaded models
  ├── llama-server sidecar：随 App 打包二进制
  └── GGUF models：用户下载至 <app-data>/ai/models/<model-id>/model.gguf
```

---

## 3. 模型三档位体系与选型设计

| 档位 | 参数量 | 默认底座 | Q4_K_M 体积 | 推荐配置 | 适用场景 | 当前状态 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Lite** | **0.5B** | `Qwen2.5-0.5B-Instruct` | ~491 MB | 内存 4GB+ | 极速轻量，秒级响应，适合轻薄本与低内存设备 | **已就绪** |
| **Standard** | **1.5B** | `Qwen2.5-Coder-1.5B-Instruct` | ~1.05 GB | 内存 8GB+ (推荐 16GB+ M系列 Mac) | 连贯写作、精准错别字/标点修复，Markdown/MDX 边界保护 | **已就绪 (推荐)** |
| **Pro** | **3B** | `Qwen2.5-3B-Instruct` / 自研微调 | ~2.10 GB | 内存 16GB+ | 旗舰级深度长文创作、论文润色与逻辑重构 | **即将推出 (占位)** |

### 硬件检测与推荐算法：
- 物理内存 $\ge$ 7.5 GB：推荐 **Standard (1.5B)**；
- 物理内存 $<$ 7.5 GB：推荐 **Lite (0.5B)**。

---

## 4. 模型生命周期管理：删除与版本更新规范

### 4.1 核心语义：无“重新下载”，统一为【更新模型】
1. **未下载状态**：展示【下载模型】按钮，直接拉取当前 Manifest 指定的最新版本。
2. **已下载且为最新版本**：展示【更新模型】（用于重新校验覆盖）与【删除模型】。
3. **已下载且检测到新版本（`currentVersion != latestVersion`）**：
   - 卡片突出展示蓝色徽标 `发现新版本 vX.Y.Z`；
   - 主按钮高亮显示为【更新模型】；
   - 点击后后台下载 `download.tmp`，SHA256 校验通过后，先调用 `stop_runtime_if_model` 终止旧模型进程，再原子重命名覆盖 `model.gguf` 并更新本地 `manifest.json`。
4. **删除模型**：
   - 终止正在运行该模型的 sidecar 进程，释放文件句柄；
   - 彻底删除 `<app-data>/ai/models/<model-id>` 目录，释放磁盘空间；
   - 状态重置为 `not-downloaded`。
5. **手动检查更新**：
   - 设置面板提供【检查模型更新】按钮，触发全量模型 Manifest 版本对比。

---

## 5. 推理层 GBNF 语法与 JSON Schema 约束解码

为解决小模型（尤其是 0.5B / 1.5B）不遵守 Prompt 指令、带出 Markdown 围栏或废话的问题，在 `local_ai_completion.rs` 请求体中传入严格受限的 JSON Schema：

```json
{
  "type": "json_object",
  "schema": {
    "type": "object",
    "properties": {
      "continuation": { "type": "string" },
      "edit": {
        "type": ["object", "null"],
        "properties": {
          "original": { "type": "string" },
          "replacement": { "type": "string" },
          "reason": { "type": "string" }
        },
        "required": ["original", "replacement"]
      }
    },
    "required": ["continuation", "edit"]
  }
}
```
结合 GBNF 采样器，在 Logit 采样时通过状态机屏蔽非法 Token，数学级保障输出合法。

---

## 6. 二次开发专属模型工程方案（路线 B）

为构建专属于 `md-editor` 的本地写作模型壁垒：
1. **独立仓库**：建立 `md-editor-models` 仓库，隔离 Python/PyTorch/CUDA/Unsloth 庞大环境与几十 GB 的训练权重；
2. **专用数据集**：构建 50k~80k 条中英文 Markdown 语料（续写、错别字纠错、Pangu 标点空格规范、MDX 边界保护、负样本）；
3. **微调与发布**：基于 `Qwen2.5-Coder-1.5B` 进行 SFT 训练，使用 `llama.cpp` 量化为 `Q4_K_M` GGUF，托管在 Hugging Face / CDN，客户端通过 Manifest 版本更新机制无感推送到用户端。

---

## 7. 编辑器输入停顿智能触发流水线

当用户输入停止（防抖 1000ms）后，编辑器执行两阶段智能流水线：
1. **阶段 1（优先语法与润色）**：发起 `intent: "editing"` 审校请求。若检测出错别字、标点错误或语病，立即在行内以 Diff 形式高亮呈现【修改建议】，并**终止**后续续写流程；
2. **阶段 2（无误触发续写）**：若阶段 1 语法检查完全通过（`edit` 为 null），且用户开启了【AI 续写】功能，紧接着在光标处发起 `intent: "continuation"` 请求，以低饱和度灰色 Ghost Text 呈现连贯的后续写作建议。
