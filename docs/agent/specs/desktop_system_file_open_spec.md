# 桌面端系统文件打开契约

> 状态：Inkpoint 桌面端当前生效契约。

## 用途

记录从 Finder 或其他系统文件管理器打开 Markdown 文件时，安装包文件关联、Tauri 原生运行时与编辑器文档动作之间必须保持的行为。修改文件关联、Tauri 启动流程、原生文件事件、桌面文档控制器或文件扩展名规则前，先读本规范。

## 缺陷背景

macOS 安装包已声明 Markdown 文件关联，但应用未处理 Tauri `RunEvent::Opened`。LaunchServices 因此可以启动 Inkpoint，传入的文件 URL 却没有送入编辑器。窗口出现而目标文件没有打开。

## 行为契约

1. **文件关联属于可读取范围**：安装配置声明的每种扩展名都必须被共享的 `file_commands::path_utils::is_markdown_path` 接受。新增文件关联时同步读取能力，并运行扩展名契约测试；编辑器支持的扩展名可以多于系统关联声明。
2. **平台事件进入原生队列**：macOS 将 `RunEvent::Opened` 中的本地文件 URL 解码为路径；Windows 和 Linux 从启动参数读取路径。URL 必须使用 Tauri URL 转换 API 解码，确保空格、`#` 与非 ASCII 字符可用。忽略非本地 URL、命令行选项和不支持的扩展名。
3. **冷启动先暂存，再交给前端**：原生事件可能先于编辑器与前端监听器初始化。原生端先按到达顺序将路径放入待处理队列。主窗口完成控制器挂载后，前端先注册文件打开事件监听，再通过 `take_pending_file_open` 逐条取出队列项；该命令只允许主窗口消费。
4. **运行中打开保持 FIFO**：每个新原生请求先入队，再以 `md-editor-file-open` 通知主窗口，并将主窗口显示、取消最小化和置前。前端串行取队列和调用文档动作，通知只用于唤醒队列读取，不携带另一份待打开路径。重复通知不得为同一个队列项额外打开文件；用户两次独立请求打开相同路径仍保留为两个队列项。
5. **使用现有文档替换保护**：文件请求走 `openRecentFile` 及其既有读取、替换、最近文件和目录刷新逻辑。销毁当前文档前先从渲染器 flush 暂存编辑，再检查 dirty 状态。用户取消时保留当前文档；确认保存且保存成功后才继续；确认放弃后打开目标文件。文件读取失败时报告错误并保留当前文档。
6. **单文档语义**：队列按 FIFO 顺序尝试打开文件。应用仍只显示一个活动文档，因此连续成功打开时最后一个成功打开的文件可见。契约不承诺应用崩溃或重启时的 exactly-once 语义，也不承诺一次打开请求生成多个编辑器标签。

## 回归验证

| 边界 | 测试 | 必须覆盖的行为 |
| --- | --- | --- |
| Rust 原生适配 | `apps/desktop/src-tauri/src/file_open.rs` 内单测 | 队列顺序、CLI 路径与 file URL 解码、忽略远程 URL 和不支持的类型、macOS URL 特殊字符解码、配置声明的全部扩展名都被文件读取器接受 |
| 前端队列适配 | `apps/desktop/tests/desktop/file-open-events.test.ts` | 冷启动监听建立后 drain、运行中连续请求串行处理、读取竞态不丢请求、打开失败后继续处理、IPC 读取失败后新通知可重试、卸载后停止消费队列、React StrictMode setup/cleanup 不消费请求、浏览器模式不注册 Tauri 监听 |
| 生产控制器绑定 | `apps/desktop/tests/app/controller/system-file-open-wiring.test.ts` | 直接挂载 `useDesktopEditorController`，验证系统请求进入文档动作、重新渲染不重复订阅且调用最新动作与错误反馈、卸载清理监听；测试夹具不得自行补上生产监听绑定 |
| 文档动作集成 | `apps/desktop/tests/app/controller/system-file-open.test.ts` | 冷启动文件实际进入文档模型、取消保留旧文档、dirty 检查前 flush 暂存输入、确认放弃后打开、保存完成后才读取目标、保存失败或结果不确定时阻止切换、读取失败保留原文并反馈 |

补充回归测试时遵守[测试区分力规范](./editor_interaction_test_discriminating_power_spec.md)：临时移除生产控制器的系统监听绑定、移除打开路径的未保存保护或移除 dirty 检查前的 flush，对应测试必须失败，然后恢复实现重跑。只测试自行建立监听的夹具，无法拦住本次缺陷的回退。

日常自动化验证命令：

```bash
pnpm --filter @md-editor/desktop exec vitest run tests/desktop/file-open-events.test.ts tests/app/controller/system-file-open-wiring.test.ts tests/app/controller/system-file-open.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml file_open::tests
```

以上自动化测试验证应用内部协议，不验证已安装应用在 LaunchServices 中的注册或分发行为。发布前必须在 macOS 安装包上人工验收：

1. 完全退出应用后，在 Finder 双击 `.md` 文件，确认 Inkpoint 打开且显示该文件内容；
2. 应用运行时再双击另一文件，确认应用窗口置前并切换到新文件；
3. 使用路径含空格、`#` 和中文字符的文件重复冷启动与运行中验收；
4. 对脏文档选择取消和放弃，确认取消保留内容、放弃后显示目标文件；
5. 从 Finder 打开已移动或不可读文件，确认错误反馈且当前文档内容仍在；
6. 安装包的文件关联 Bundle ID 与运行应用的签名/Bundle ID 一致。

Linux `.desktop` 模板向桌面环境传递文件参数的打包验收属于 Linux 发布契约；macOS 的测试与人工验收不能替代它。
