# Rust Beta 编辑器交互审计

本文记录 2026-11-28 在 `beta@2e5f5d47` 上复现的交互问题，供缺陷排期和回归验收使用。对照范围是 Tauri/React 时代留下的用户可见行为，以及 [GPUI 迁移时的验收记录](../status/gpui-tauri-editor-parity-handoff.md)。优先级按正文受损风险、对连续写作的影响和触发频率排序。验证步骤中的 `Cmd` 是 macOS 键位。

## P1 正文完整性

### 查找替换沿用过期位置

在 `one cat two` 中查找 `cat`，保持查找栏打开，回到正文开头插入 `X`。执行单次替换，把 `cat` 换成 `DOG`。结果是 `XoneDOGt two`，预期是 `Xone DOG two`。

当前匹配缓存在原有字节范围 `4..7`。正文改动后，单次替换先应用该范围，再重新查找。验收时应同时检查匹配高亮和替换结果，并覆盖在匹配前插入或删除内容的情况。见[查找栏实现](../../../packages/editor-gpui/src/find.rs#L121)和[单次替换入口](../../../packages/editor-gpui/src/find.rs#L168)。

### 恢复旧草稿覆盖新的编辑

打开有未保存草稿的文件，先在正文新增文字，再点「恢复草稿」。正文会切换到旧草稿，`Cmd+Z` 无法找回新增文字。复现中磁盘上的原文件仍是保存时的内容，丢失的是本轮尚未保存的编辑。

恢复入口替换整个文档，并复用会清空撤销历史的换文档操作。验收时应覆盖已有新编辑的恢复操作，并确认用户能保住新内容或通过撤销找回。见[草稿恢复入口](../../../apps/desktop/src/workspace.rs#L737)和[核心文档替换](../../../packages/editor-core/src/session.rs#L586)。

### 代码块首行退格吞掉围栏后的换行

在所见即所得模式打开以下内容。点到 `const` 前，按一次 Backspace，源码首行变成 ` ```jsconst n = 1; `。代码首行被并到开始围栏的语言行里。

````markdown
```js
const n = 1;
```
````

渲染层把点击落在正文首字节，退格按这个源码位置删除前一个字符，也就是开始围栏后的换行。验收时应检查代码块边界处的一次退格能保住正文结构。见[视图退格入口](../../../packages/editor-gpui/src/typeset_view.rs#L542)和[核心退格](../../../packages/editor-core/src/session.rs#L682)。

### 表头单元格粘贴多行文本会拆开表头

用下方两列表格，在所见即所得模式选中 `left`，粘贴含实际换行的 `first\nsecond`。粘贴后，`first` 所在行成了表格外的段落，`second` 成了表格首列的表头。

```markdown
| left | right |
| ---- | ----- |
| x    | y     |
```

粘贴走普通插入。核心已有单元格内竖线转义，原始换行仍会进入表格源码。验收时应检查粘贴只修改目标格，并保住表头、列数和其他单元格。见[粘贴入口](../../../packages/editor-gpui/src/typeset_view.rs#L776)、[单元格转义](../../../packages/editor-core/src/session.rs#L909)和[表格 spec](../specs/wysiwyg_table_editing_and_lifecycle_spec.md#4-源码转义与安全授权修改)。

## P2 写作与文件交互

### 表格导航与续写

以下场景均可用上面的两列表格复现。

| 操作                                                      | 实际结果                                                             | 回归验收                                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档以表格结尾且无尾随换行。点击表格下方留白并输入 `继续` | 光标的源码偏移已到文末，输入仍直接接到最后一个 `\|` 后，留在表格末行 | 输入形成独立段落，表格行保持原样。参照[文末续写历史 spec](../specs/wysiwyg_virtual_trailing_line_spec.md)。                                                                                                            |
| 表格后另有一段正文。从左侧表头按方向键 ↓                  | 跳到表格之后，越过同一列的下一格                                     | 从表头可以向下到达同列单元格。[垂直导航实现](../../../packages/editor-typeset/src/lib.rs#L509)当前会跳过同一个块中的其余格。                                                                                           |
| 切到源码模式，把光标放到最后一个单元格，按 Tab            | 表格多出一行空单元格                                                 | 源码模式的 Tab 按源码编辑规则处理。表格跳格和末格增行在所见即所得模式验收。见[键位绑定](../../../packages/editor-gpui/src/typeset_view.rs#L1071)和[表格导航](../../../packages/editor-gpui/src/typeset_view.rs#L399)。 |

### 正文 Tab 与历史缩进规则不一致

在普通正文行内放置单光标并按 Tab，当前会在光标处插入制表符。历史 spec 规定行首增加两个空格，Shift+Tab 做对称的行首反缩进，并保持正文焦点。验收时应区分单光标正文、多行选区和列表等结构。见[正文 Tab 契约](../specs/editor_interaction_tab_and_links_spec.md#契约一tab-的归属--编辑器内容消费-tab)和[当前键位绑定](../../../packages/editor-gpui/src/typeset_view.rs#L1071)。

### 普通点击外链，文内锚点走外部打开

- 在所见即所得模式普通单击 `[link label](https://example.com)` 的标签，GPUI 收到了打开 URL 的请求。普通点击原应将光标放进链接供用户编辑，外部打开由 `Cmd/Ctrl+点击` 触发。见[链接点击契约](../specs/editor_interaction_tab_and_links_spec.md#契约二链接类文本--既可编辑也可打开)。
- 文档包含 `[跳转](#target)` 和标题 `# Target` 时，`Cmd+点击` 向外部打开接口传入了 `#target`。预期是在当前文档里跳到标题。见[文档内锚点契约](../specs/editor_interaction_tab_and_links_spec.md#文档内锚点fragment)。

### 切换源码模式把视口拉回屏外光标

用 500 段的文档，把光标留在开头，滚到约第 300 段，再按 `Cmd+/`。切换后选区仍在原处，视口却跳回文档开头。验收时应让屏外光标保留原位置，同时在两种模式之间维持相近的阅读位置。见[模式切换入口](../../../packages/editor-gpui/src/typeset_view/source_mode.rs#L29)和[阅读态视口历史 spec](../specs/editor_mode_switch_viewport_and_cursor_spec.md#3-阅读态视口保持契约-off-screen-cursor-preservation)。

### 本地图片已落盘但预览缺失

在已保存的文档中粘贴 PNG。原始图片写入了磁盘，Markdown 也插入了 `./assets/...`，状态栏显示 `Image inserted`。渲染测试中的 HTTP 客户端却收到了该相对路径，因此应用没有从当前文档目录读取这张图片。测试拦截了请求，全程使用本地夹具。

当 `assets` 尚不存在时，粘贴还会直接创建它。历史 spec 要求先确认，取消后保持文档和目录原状。验收需要同时检查落盘、相对引用和所见即所得预览，并覆盖从文档所在目录解析已有相对链接。见[桌面图片写入](../../../apps/desktop/src/image_assets.rs#L9)、[预览上下文](../../../packages/editor-gpui/src/typeset_view.rs#L125)和[图片路径 spec](../specs/image_path_resolution_and_directory_creation_spec.md)。

### 系统打开文件会丢掉后续请求

复现了两条路径。给 URL 回调一次传入 A、B 两个有效 Markdown URL，只收到 A。把 A、B 分两次送给工作区，若 A 还在异步读取，B 也会被丢弃。等 A 读取完成后重发 B，可以正常打开。

历史 spec 要求按到达顺序逐条处理，保留单个活动文档语义。A、B 都成功时，最终应显示 B。含空格、`#` 和中文的路径解码已通过。单个请求也通过了取消、保存、放弃、保存失败和读取失败的验证。见[URL 回调](../../../apps/desktop/src/main.rs#L79)、[文件操作入口](../../../apps/desktop/src/workspace.rs#L296)和[系统打开 spec](../specs/desktop_system_file_open_spec.md#行为契约)。

### 原文件移走后，已有草稿缺少恢复入口

模拟退出时已持久化的具名草稿，再让原文件路径失效。重启进入欢迎页，草稿内容仍在会话文件中，界面没有提供恢复入口。作为对照，未命名的中文草稿可以恢复正文和原光标位置。见[启动检查](../../../apps/desktop/src/workspace.rs#L771)。

### 切换源码后，旧 AI 建议仍可接受

在所见即所得模式注入一条已经返回的本地 AI 建议，按 `Cmd+/`。进入源码模式后，建议仍显示，执行接受仍会插入文字。历史行为要求切换时清除已有建议。本次复现覆盖建议到达后的应用逻辑，模型请求使用替代结果。见[建议接收与接受](../../../apps/desktop/src/workspace.rs#L689)和[AI 生命周期历史 spec](../specs/editor_mode_switch_and_ai_lifecycle_spec.md)。

### 中文标点相邻时粗体跨对错配

以下样例来自历史 spec。

```markdown
本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定」**的完整落地路径
```

核心解析只将中间的「到」识别为粗体。预期是两段引号内的词组各自独立加粗。「到」保持普通文本。本次复现用的是粗体样例，删除线和高亮仍是 [CJK spec](../specs/cjk_friendly_emphasis_spec.md) 的回归范围。见[核心强调解析](../../../packages/editor-core/src/lib.rs#L168)。

## 中文输入与长文性能

中文组词回调测试通过。测试覆盖候选态、连续提交两个词、取消拼音、重新组词和撤销最后一次提交。短段落在组词前后的光标行高一致，取消后光标回到原位置。见[原生输入桥接](../../../packages/editor-gpui/src/typeset_view/ime.rs)和[中文输入法历史 spec](../specs/archive/wysiwyg_chinese_ime_composition_layout_spec.md#手动验收场景)。

同一台 Mac 的优化构建中，每种文档从输入回调到调用绘制测量 35 次。1,000 段的内置验收用例以 33 ms 为 p95 门槛，另一次独立运行测得 29.36 ms。调试构建同一用例为 481.36 ms。扩展夹具的结果如下。见[仓库内置性能用例](../../../packages/editor-gpui/tests/support/native_writing.rs#L339)。

| 文档                           |      p50 |      p95 |
| ------------------------------ | -------: | -------: |
| 1,000 段中英混排正文           | 29.03 ms | 30.16 ms |
| 2,000 段中英混排正文           | 63.39 ms | 66.06 ms |
| 30 段正文加 16 个 Mermaid 围栏 | 24.56 ms | 25.66 ms |

2,000 段的夹具揭示了随文档增长而增加的延迟。该测量止于 GPUI 绘制调用，实机验收还需要观察窗口呈现和输入手感。

## 验证记录与待实测范围

- `cargo test --locked --workspace` 通过 195 项，默认忽略 1 项性能用例。性能用例单独运行。
- 两轮补充复现使用 GPUI 测试上下文、临时 Markdown 文件和隔离应用数据。草稿恢复与接受 AI 建议调用生产处理函数，系统打开覆盖 URL 回调逻辑和工作区消费入口。
- macOS 实机仍需核对系统拼音候选窗、系统剪贴板、Finder 冷启动和窗口置前，以及实际窗口输入手感。本轮自动审批要求单独授权启动临时签名的隔离测试包。Windows 和 Linux 的文件管理器打开也待在各平台实测。见[系统打开发布验收项](../specs/desktop_system_file_open_spec.md#回归验证)。
