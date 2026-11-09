# 用户风格学习（写作偏好）架构

用途：说明写作偏好的数据模型、分层边界、学习时机、画像闸门与注入契约。改动风格学习、续写或纠错的画像注入、风格学习存储或排除规则之前先读本文。

需求与决策来源：`.omx/specs/deep-interview-user-style-learning.md`、`.omx/plans/prd-user-style-learning.md`。产品层面的说明见 [AI 功能需求 §8](../product/markdown_editor_ai_feature_requirements.md)。

## 1. 分层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Rust 文件系统 | `apps/desktop/src-tauri/src/style_learning/` | 当前工作区范围、样本扫描（默认排除 + 用户排除，前缀匹配）、sha256、读取范围校验、应用数据目录内的原子读写与清除。不读写工作区文件，不使用 `.aiignore`。 |
| 画像领域（轻量） | `@md-editor/ai/style`（`packages/ai/src/style/index.ts`） | 类型、维度目录、生命周期、身份校验、合并、渲染、闸门、纠错风格规则、编辑反馈特征。无 Markdown 解析依赖，主入口可安全引用。 |
| 学习引擎 | `@md-editor/ai/style-engine`（`engine-entry.ts`） | 散文抽取（`marked`）、统计、分类请求与解析、聚合、学习轮次引擎。桌面端在首次学习时动态加载。 |
| 写作服务 | `packages/ai/src/app/writing-service.ts` | 在续写、统一建议、纠错内调用闸门；纠错结果经误报过滤与风格建议处理。 |
| 编辑器 | `packages/renderer-codemirror` | 建议项 `kind`（`fix` / `style`）与徽标；采纳建议时在事务上附 `aiSuggestionAcceptedAnnotation`。 |
| 桌面组合根 | `apps/desktop/src/app/ai/style-learning/` | 学习时机（协调器）、宿主端口实现、采纳登记、编辑反馈缓冲、排除列表、云端授权、设置页与文件树菜单。 |

## 2. 数据

应用数据目录 `style-learning/` 下两份版本化 JSON（`version: 1`）：

- `profile.json`（`StyleProfileDocument`）：工作区画像（样本 hash 与派生特征、规则、编辑特征）、全局画像、自定义规则、采纳 AI 句子的 hash。**不保存任何原文或 AI 文本。**“清除风格学习数据”删除它。
- `exclusions.json`（`StyleExclusionsDocument`）：工作区根路径 → 工作区相对路径列表。清除学习数据时保留，可单独清空。

一致性：

- 所有写入都经过桌面端 `updateStyleProfile` / `updateStyleExclusions`：读取最新文档 → 应用修改 → 按 `revision` 比较后写入（Rust 侧在写锁内比较，不一致返回 `style-learning-stale`，调用方重试）。写入成功后广播 `md-editor-style-profile-changed` / `md-editor-style-exclusions-changed`，主窗口与独立设置窗口都通过 `useStyleLearningData` 跟随。
- 字段归属：学习引擎只提交本轮触及的工作区记录与全局层（`mergeOwnedChanges`）；自定义规则（设置页）、采纳 AI 段与编辑特征（编辑器，文档级 `aiSegments` / `editFeedback` 按工作区 id 分组）以最新文档为准。提交时若本轮负责的工作区已被其他写入者改动身份字段或样本路径（撤销找回、重命名同步），本轮结果丢弃（`discarded`），下次基于最新数据重算。
- 内存镜像：存储层广播的文档是唯一来源；学习轮次只在真正写入时把文档交给宿主。`setProfile` 只接受清除、新数据代次或不更旧的 revision。
- 无变化的修改不写盘、不广播；风格学习从未开启（内存中没有画像）时重命名不触发任何写入。
- 清除数据会删除文件（revision 归零），新文档带新的 `epoch`；进行中的轮次提交时发现已清除（`wasClearedSince`）即丢弃结果，旧副本无法把数据写回。
- 扫描与读取携带期望的工作区根目录，Rust 发现范围已切换时拒绝，避免把新目录的内容记到旧画像。

规格 §7 要求的规则字段映射：id = `layer:dimension`；layer 由所在位置决定；text 由维度模板渲染；evidence = `supportSampleIds`；只有自定义 `note` 存自由文本。

## 3. 学习

- 前提：开关开启、本地 Standard 已下载、打开了工作区。
- 时机：编辑器 2 分钟无输入、文档已保存、窗口可见；写作模型为热 Lite 时等 runtime 空闲满 5 分钟（桌面 bridge 在每次用户侧本地请求时通知协调器）。
- 失败按 1、2、4…分钟退避（最长 1 小时）；窗口重新可见只重新安排已有工作。
- 只在有待处理的变化时运行：打开工作区、保存文档、文件夹变化、设置或模型变化，或上一轮被抢占、模型忙、失败、刚更新了样本。空闲本身不触发重复扫描，无变化时不写盘。
- 调度：每个分类块经共享 `AiRequestScheduler` 以 `exclusive` 派发；用户请求到达即抢占，Rust 侧取消冷加载；Rust 拒绝为学习切换正在使用的其他模型（`local-ai-busy`）。
- 轮次：累计 20 个样本变化或首次学习（≥ 5 个样本，分 3 组）触发；删除、排除或内容变化的样本立即丢弃旧特征并重新聚合。
- 草稿机制：最近 3 轮同值、支持文件 ≥ 5、统计变异系数 ≤ 0.25 才生效；连续 3 轮不支持或支持不足退场。全局层由 ≥ 2 个工作区一致的生效规则推导。
- 身份：段落 hash 包含度 < 0.3 视为失去关联；开启自动找回时 ≥ 0.5 且匹配 ≥ 3 个样本改绑并提示（设置页可撤销，排除列表随之迁移；撤销后不再自动找回到同一目录）；失联 30 天清理。
- 使用前校验：打开或切换工作区时先做一次不调用模型的身份校验（`verifyWorkspace`），通过之前写作请求只使用全局画像与自定义规则。
- 排除立即生效（PRD §2.10）：文件树右键或设置页排除文件后，`applyExclusions` 立刻把被排除的样本与对应 AI 段 hash 从画像中剔除并重新聚合当前轮（不调用模型），再通知协调器在空闲时补读恢复的文件。设置页“参与学习的文章”只列出仍在参与的文件，被排除的只出现在“已排除”。
- 计量（PRD §2.6）：dev 日志输出本轮 `preemptions`、`modelSwitches`、`windows` 与调度器 `urgentWaitMs`（count/max/p95）、`exclusivePreemptions`。设置页状态行显示上次学习时间、参与样本数与生效规则数。
- Sentry（PRD §2.8 / O-3）：`handleBeforeSend` 识别风格学习事件并去掉绝对路径与文件名，只保留错误描述。
- AI 文本：采纳时记录句子 hash，学习时跳过；AI 原文只在内存中保留到保存，用于提取“用户修改 AI 建议”的特征。

## 4. 使用

- 闸门（`gateStyleProfile`）：开关关闭、Lite 模型、云端未授权（授权绑定 provider + origin）时不附带画像。宿主是可信组合根，闸门防的是漏传误传。
- 前缀：`[写作偏好]` + 优先级契约（当前文章语境与本次指令优先）+ 规则文字，约 200 token 预算，按层级与维度权重截断。
- 续写与幽灵续写：使用完整前缀。云端授权只在手动续写时询问，幽灵续写从不弹窗。
- 纠错：手动纠错与手动续写一样在云端首次使用时询问授权；云端提示附宽容版前缀（只列机械维度，“不视为错误”）；结果中丢弃与习惯冲突的修改，追加 `kind: "style"` 的风格建议（中英文空格、中文后标点宽度），跳过代码与链接。

## 5. 验证

- 单元：`packages/ai/tests/style/**`、`packages/ai/tests/writing-service-style.test.ts`、`packages/ai/tests/request-scheduler.test.ts`、`packages/ai/tests/logger-redaction.test.ts`。
- 桌面：`apps/desktop/tests/app/ai/**`、`apps/desktop/tests/components/style-learning-settings.test.ts`、`apps/desktop/tests/components/file-tree-style-learning-menu.test.ts`。
- Rust：`style_learning::tests`、`local_ai_runtime` 与 `local_ai_completion` 中的风格学习用例。
- 验收评测：`scripts/style-eval/`（`pnpm test:style-eval` 覆盖纯函数；`run.mjs` 生成盲评表，见文件头说明）。用户偏好有画像版本过半且采纳后修改量下降，才扩大自动化范围。

## 6. 下一版本

- 系统文件 ID 辅助找回（Windows `FILE_ID_INFO`、Linux/macOS dev+inode，仅作辅助校验）。
- 多份命名画像的切换与优先级、子目录级画像。
