# 本地 AI 多档位模型体系、硬件检测与生命周期管理状态记录

用途：记录本地小模型多档位体系（Lite/Standard/Pro）、硬件检测推荐、按模型独立在线更新/删除生命周期、GBNF 严格语法约束解码的实现进度、验证结果与演进记录。

## 1. 阶段目标与功能清单

- [x] **多档位模型体系（Lite 0.5B / Standard 1.5B / Pro 3B 占位）**
  - [x] `@md-editor/ai` 预置模型清单与多档位类型定义 (`LocalModelTier`, `BUILTIN_LOCAL_MODELS`)。
  - [x] Rust 侧扩展 Manifest 列表，支持 Lite (0.5B)、Standard (1.5B) 与 Pro (3B 占位)。
  - [x] 兼容旧版单一模型 ID 配置 (`md-editor-writer-small-v1` 自动解析为 `md-editor-writer-lite`)。
- [x] **系统硬件检测与智能推荐**
  - [x] Rust 实现 `get_system_specs` 命令（读取 CPU 架构、核心数与物理内存字节）。
  - [x] 前端硬件推荐判定规则（$\ge$ 7.5GB 推荐 Standard，$<$ 7.5GB 推荐 Lite）。
  - [x] UI 展示系统硬件概览卡片与 `⚡ 当前设备推荐` 徽标。
- [x] **按模型精准独立生命周期管理（下载 / 更新 / 删除）**
  - [x] 模型状态支持 `currentVersion`、`latestVersion` 与 `hasUpdate`。
  - [x] 仅在已下载模型发布新版本时展示【更新模型 (发现新版本)】；未下载模型显示【下载模型】；已是最新版显示【更新模型】（用于覆盖校验）。
  - [x] 删除模型前优雅停止运行中 `llama-server` 子进程，释放文件句柄并清理目录。
  - [x] 提供【检查模型更新】手动刷新机制与 Toast 反馈。
- [x] **GBNF / 严格 JSON Schema 采样约束**
  - [x] `local_ai_completion.rs` 构造请求时注入严格 schema，防止 0.5B/1.5B 模型输出代码围栏或多余闲聊。
- [x] **Claude & Open Design 视觉规范落地**
  - [x] 实现三档位响应式卡片网格（Lite / Standard / Pro 占位卡片）。
  - [x] 动态平滑进度条、状态圆点与危险操作防误触样式。

## 2. 验证与回归记录

- 单元测试覆盖：
  - [x] `@md-editor/ai` 模型多档位与设置归一化测试 (`packages/ai/tests/ai-completion.test.ts`)。
  - [x] `apps/desktop` 本地模型状态管理与硬件推荐逻辑测试 (`apps/desktop/tests/local-ai-multi-tier.test.ts`)。
  - [x] `apps/desktop` 默认设置与快捷键对齐测试 (`apps/desktop/tests/app-settings.test.ts`)。
  - [x] Rust 后端 Manifest 解析与硬件信息测试 (`system_info.rs`、`local_ai_model.rs` 内置测试用例)。
- 手动与交互验证：
  - [x] 设置面板视觉还原度与响应式测试（宽屏 3 列 / 窄屏响应式折叠）。
  - [x] Lite / Standard 下载、更新与删除流转。
  - [x] 离线与断网状态下本地推理生成。
