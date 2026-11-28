# GPUI Beta 交互修复：实施与验收证据

用途：记录 Rust Beta 编辑器交互修复的**已完成工作、实测证据与已知限制**，供 review 与后续接手使用。方案类内容标注为「未实现」，不作为当前实现承诺。

相关来源：审计 [`../review/gpui-beta-editor-interaction-audit.md`](../review/gpui-beta-editor-interaction-audit.md)、需求 [`../specs/editor_interaction_tab_and_links_spec.md`](../specs/editor_interaction_tab_and_links_spec.md)、图片路径 [`../specs/image_path_resolution_and_directory_creation_spec.md`](../specs/image_path_resolution_and_directory_creation_spec.md)、系统打开 [`../specs/desktop_system_file_open_spec.md`](../specs/desktop_system_file_open_spec.md)。

## 当前状态

| 项 | 结果 |
|---|---|
| 门禁 | `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --locked -D warnings`（0 警告）、`cargo test --workspace --locked`（**353 项通过，0 失败**）、`cargo build --workspace --locked` |
| 1,000 段性能 | p50 29.8–29.9 ms，p95 **30.0–31.5 ms**，门槛 33 ms ✅ |
| 2,000 段性能 | p50 66.2–66.7 ms，p95 **67–74 ms**，门槛 45 ms ❌ |
| macOS 实机验收 | 可自动化部分 10/10 通过；**7 项人工验收未执行** |

性能数据是同一台 Apple M1 Pro、同一 release 配置、同一 harness 与 fixture 多次复测的**区间**。p95 是 35 个样本的尾部值，跨轮有抖动（曾见 67.21 与 74.00）；判断是否退化看 **p50**，它稳定在 66.2–66.7 ms。

复现命令：

```
cargo test --release --locked -p inkpoint-editor-gpui --lib \
  native_long_document_input_to_paint -- --ignored --nocapture --test-threads=1
```

该测试带 `#[ignore]`，**CI 不执行**（测试规格要求同机 release 35 样本，不适合放 CI）。所以 2,000 段的性能回归只能靠手动执行这条命令发现。

## 已修复的交互缺陷

按审计矩阵归集，每项都指明生产入口而非仅测试。

| 矩阵 | 修复内容 | 关键位置 |
|---|---|---|
| CJK-01 | 全角标点邻接时 CommonMark flanking 双侧失败，`**「a」**到**「b」**` 把 `到` 加粗。按 CJK-friendly amendment 把 CJK 标点重写为等字节长度普通汉字后再解析，偏移量全部保持有效 | `editor-core/src/cjk.rs` |
| FENCE-01 | 代码体首字节退格曾吞掉开围栏换行，把代码并进 info string。新增边界检测并拒绝该次删除 | `editor-core/src/fence.rs` |
| TABLE-PASTE-01 | 多行文本曾把表格拆成段落+新首列。改为按历史单格序列化语义折叠换行、转义竖管 | `editor-core/src/session.rs` |
| TAB-01 | 正文 Tab 曾在光标处插入字面 tab。改为两空格行缩进并保持光标在同字符，列表规则仍优先 | `editor-core/src/session.rs` |
| TABLE-EXIT-01 | 文末表格下方输入曾接进最后一个单元格（EOF 偏移在表格内）。同一编辑内先补段落分隔 | `editor-core/src/table_navigation.rs` |
| TABLE-HANDLE/COL/GUARD/RAGGED/ALIGN | 新增 `table_edit`：行/列插删与对齐。插入重建（ragged row 需补齐），删除字节手术（保住其它字节、竖管、空格）。不可表示时返回 `None` 而非半应用 | `editor-core/src/table_edit.rs` |
| TABLE-HANDLE（可视控件） | 行/列手柄：按已布局矩形放置并命中测试（纯几何），视图负责分组、指针跟踪、点击路由与绘制。仅提供插入，删除与对齐留在 Table 菜单 | `editor-typeset/src/table_handle.rs`、`editor-gpui/src/typeset_view/table_handles.rs` |
| FIND-01/02 | 曾用缓存区间替换，产生 `XoneDOGt two`。改为先重定位活匹配再走 guarded 路径；记录产生匹配的 query 而非回读输入框 | `editor-gpui/src/find.rs` |
| TABLE-NAV-01 | 表格内 ↓ 曾跳过整表（垂直移动按 leaf 走，表格是一个 leaf）。先走核心单元格导航 | `editor-core/src/table_navigation.rs` |
| TAB-01/TABLE-SOURCE-01 | 源码模式曾占用表格上下文导致 Tab 增行；普通正文折叠光标没有 Tab 绑定。按模式分流 | `editor-gpui/src/typeset_view.rs` |
| VIEW-01 | 切源码模式曾跳回屏外光标。切换前记住顶部 source offset，切换后恢复 | `editor-gpui/src/typeset_view/source_mode.rs` |
| LINK-01..04 | 普通点击曾把 URL 交给外部打开；`#fragment` 也被交出去。改为普通点击选中标签可编辑、修饰键才跟随；锚点在编辑器内解析（全角标点、中文、百分号编码、重名标题、空片段、未命中）；本地链接按文档目录解析 | `editor-core/src/links.rs`、`apps/desktop/src/link_target.rs` |
| IMAGE-01 | 相对图片曾送到 HTTP 客户端。新增本地路径解析，远程/内联保持默认 | `editor-gpui/src/image_source.rs` |
| IMAGE-02/03 | `${filename}`/`./`/`../`/绝对目录、正斜杠引用、符号链接逃逸拒绝、缺目录先确认（取消无副作用） | `apps/desktop/src/image_assets.rs` |
| AI-01 | 切模式后旧建议仍可接受。新增 mode generation，suggestion 与 paste target 均携带 | `editor-core/src/session.rs` |
| DRAFT-01..04 | 恢复改为一步可撤销；pending draft 与 hot-exit session 拆成两个持久 owner；原文件消失的具名草稿可恢复；未命名中文草稿 caret 往返 | `apps/desktop/src/session.rs` |
| OPEN-01..04 | 单次回调只取第一个路径、队列项无身份。改为全部 URL 入队 + delivery/index 身份去重 + FIFO + ingress 日志；忙时等待而非静默消费丢弃 | `apps/desktop/src/system_open.rs` |

## 判别力证据（在基线 `beta@2e5f5d47` 上实跑）

把基线 checkout 出来跑同一批测试，结果不是「全部转绿」那么简单：

| 测试集 | 基线表现 |
|---|---|
| `editor-core/tests/audit_reproductions.rs`（6 项） | **3 项断言失败**：CJK 强调把 `到` 加粗（`got ["到"]`）、代码体首字节退格吞掉围栏换行、多行粘贴拆断表头列数 |
| 同上另外 3 项 | **通过**，且这是设计意图——它们是 companion 守卫，断言「修复不得放宽既有语义」 |
| `editor-gpui/tests/audit_reproductions.rs`（6 项） | **编译失败**：`mode_generation` 等在基线上不存在 |

需要区分：gpui 那 6 项证明的是「API 不存在」，不等于「行为错误」。真正的行为证据是 core 那 3 项断言失败，以及 find 的复现——把 `find01` 注入基线后实跑，产出正是审计记录的 `XoneDOGt two`。

既有测试的处理逐项核对：

| 测试 | 处理 |
|---|---|
| `tab_outside_a_table_keeps_text_input_behavior` | **改写并更名**为 `tab_on_plain_prose_indents_the_line`。原断言锁定「正文 Tab 插入字面 `\t`」，审计判定为缺陷；按历史用户契约改为「缩进两空格」 |
| `find_options_and_replacement_work` | **未改动**，与基线逐字节相同。find 缺陷由**新增**的 `find01_*`/`find02_*` 覆盖 |

## 收尾自查修掉的缺陷（14 项）

交付前逐项审计自己新增的代码，每项都先写探针确认旧行为，再改成回归测试。分三类：应用缺陷 9 项、性能缺陷 3 项（另有 1 项记录未修）、验收脚本缺陷 2 项。

### 应用缺陷（9 项）

| 缺陷 | 修复前实测 |
|---|---|
| 表格手柄悬停高亮不跟随指针 | 组内移动时整组仍可见，重绘判定只看可见性 |
| 删除最后一张表后手柄残留 | 无表格时跳过重建，保留上一帧的组，形成可点击但指向不存在表格的控件 |
| `cell_at` / `table_cells_at` / `document_table_cells` 无生产调用方 | 仅测试引用；生产走 `table_cells_in` |
| `TableCell::table_start` 无生产读取方 | 仅测试引用；分组由 `Vec<Vec<..>>` 嵌套表达 |
| 链接路径百分号编码未解码 | `my%20file.md` → `Missing("...my%20file.md")`，而 `my file.md` → `Document` |
| 指针移出编辑区后手柄残留 | 移出无 mouse-move 事件，位置保持陈旧值 |
| `${filename}` 可逃出子目录 | 文档 `...md` 的 stem 是 `..`，`./assets/..` 归一化到文档目录本身 |
| 含全角标点的行内代码丢失 code mark | `` `「a」` `` → 0 个 mark，`` `a` `` → 1 个 |
| 含全角标点的围栏语言解析失败 | ` ```「rust」 ` → `language=None`，` ```rust ` → `Some("rust")` |

后两项同源：解析结果来自 CJK 改写文本，却拿去原文查找。抽出 `find_parsed_value` 回退到改写文本查找——因改写保持字节长度，偏移对原文有效。

### 性能缺陷（3 项已修，另 1 项记录未修）

| 缺陷 | 修复前 | 修复后 |
|---|---|---|
| 退格每次完整解析文档 | 1k **8.47 ms** / 2k **18.56 ms** | **2.6 µs** / **4.3 µs** |
| Enter 与上下方向键每次完整解析文档 | 1k **8.4 ms** / 2k **18.6 ms** | **4.7 µs** / **14 µs** |
| 含标题/表格的文档每次按键解析**三次** | 1k 带标题 p95 **36.20 ms**（门槛 33 ❌） | p95 **28.24 ms** ✅ |

前两处都是「渲染已解析过一遍，下游又解析一遍」。修法都是文本预筛，且预筛**过严会静默禁用原逻辑**（比性能问题更糟），所以有测试锁住宽松度：围栏的各种写法（波浪线、缩进、tab 缩进、info string 带尾空格、首行空）逐一对照解析器答案；表格覆盖无外竖管的写法。

第三处更隐蔽，也值得单独说明，因为它同时暴露了门槛本身的盲区：

`parse_projection` 用一次解析建渲染树，然后分别调用 `MarkdownDocument::blocks()` 和 `inline_marks()`，**两者各自调用一次 `to_mdast`**。`blocks()` 只在标题或表格需要 `content_range` 时被调用，所以这次多余解析只出现在「像真实文档」的文档上，而性能门槛的 fixture 是纯段落 `(0..blocks).map(perf_paragraph).join("\n\n")`，**永远不触发它**。

| 条件（1,000 段，同一 harness） | p95 | 门槛 33 |
|---|---|---|
| 加一个标题，修复前 | **36.20 ms** | ❌ |
| 加一个标题，修复后 | **28.24 ms** | ✅ |
| 仅 stub 掉第三次解析（隔离测量） | 28.46 ms | — |

一个标题就值 **7.7 ms** 的 33 ms 预算，足以把原本达标的文档推过门槛。修法是 `blocks_and_inline_marks()` 共用同一棵 AST，等价性测试断言它与两个单产物方法返回完全一致。fixture 已改为「标题 + 段落」让门槛守住这条路径（fixture hash 随之变化，与更早运行不可比）。

2,000 段的收益更大，但**仍不达标**。同一 fixture（标题 + 2,000 段，`fnv1a64=0x146b3d199ec62a3e`）：

| 条件 | p50 | p95 | 门槛 45 |
|---|---|---|---|
| 修复前 | **80.86 ms** | **82.70 ms** | ❌ |
| 修复后 | **63.07 ms** | **65.42 ms** | ❌ |

即这次修复把 2k 拉低了约 **17.8 ms（−22%）**，与 1k 的 −22% 一致，说明它确实作用在同一条路径上；但距离 45 ms 门槛还差约 18 ms，仍需增量解析。

（修复前的 2k 数字是单次测量：门槛测试在 1k 就断言失败并中止，所以 2k 只能用临时探针单独测出。这也是它长期没被发现的原因之一。）

**记录而未修**：桌面端大纲在打开 Outline 标签时每次编辑重新解析全文（1k **11.45 ms** / 2k **35.07 ms**）。改法有三个实测确认的取舍：解析器把 `标题\n====` 认作 Setext 标题而扫源码会丢、围栏内 `#` 需第二个状态机、源码模式用的 `plain_source` 对 `# 标题` 产出 0 个 heading（改读投影会让源码模式下大纲变空）。建议修法：把标题提取下沉到 `editor-core` 一次扫描，同时服务大纲与锚点链接。

### 验收脚本缺陷（2 项）

| 缺陷 | 症状 |
|---|---|
| 异步日志竞态 | `rm -f` 清空日志与应用的异步追加竞争，下一步读到上一步残留行 → 随机假失败 |
| `grep -c` 双零 | 空文件上 `grep -c .` 打印 `0` **且**以状态 1 退出，`\|\| echo 0` 再追加一个 `0`，变量变成 `"0\n0"` → `$((...))` 报 `syntax error` |

## 测试规格覆盖度

矩阵 ID 与测试的对应关系分三类：

1. **测试名带 ID**（24 个）：AI-01、ALIGN-01、CJK-01、COL-01、DRAFT-01..04、EXIT-01、FENCE-01、FIND-01/02、GUARD-01、HANDLE-01、NAV-01、OPEN-01..04、PASTE-01、RAGGED-01、SOURCE-01、TAB-01、VIEW-01。
2. **功能有测试但测试名不带 ID**（9 个）：IMAGE-01..03、LINK-01..04、IME-01、TABLE-NAV-02。这是可追溯性断裂，不是覆盖缺失——审阅者无法从矩阵 ID 反查测试。
3. **本轮补上的真实缺口**（3 个）：`PERF-MIXED-01`（此前完全缺失，G003 目标明确要求「性能变更后复查表格、Mermaid、中文组合」）、`TABLE-MODE-01`（原有 mode 测试只用段落加粗）、`TABLE-NAV-02` 的单元格内软换行（原有测试用普通段落）。

## macOS 实机验收

候选包：`0.23.4-beta.sha07e93c`，ad-hoc 签名，`aarch64-apple-darwin`，Bundle ID `com.inkpoint.gpui-preview`，Apple M1 Pro / macOS 27.0。

隔离环境 `INKPOINT_DATA_ROOT` + `INKPOINT_OPEN_INGRESS_LOG`，真实 `~/Library/Application Support/md-editor` mtime 全程未变。

可自动化部分（`scripts/acceptance/g004-macos.sh`，连跑三次 **10/10**）：

| 项 | 结果 |
|---|---|
| A1 包身份与架构 | 通过 |
| A2 冷启动投递文件 | 通过，ingress 记录 `delivery:0 urlCount:1` |
| A3 应用已开时再投递 | 通过 |
| A4 一次投递多文件按序消费 | 通过，`urlCount:2` → 按 `2:0`、`2:1` 顺序消费 |
| A5 路径含空格 / `#` / 中文 | 通过，路径原样到达 |
| A6 不可读文件仍产生投递记录 | 通过（未验证界面提示，见下） |
| A7 隔离 data root 注入进程 | 通过（`ps eww` 确认） |
| A8 真实数据目录未被写入 | 通过 |

**必须人工执行的 7 项**（判据是「屏幕上看到的结果对不对」，代理无法代替）：

| 项 | 操作 | 看什么 |
|---|---|---|
| B1 | 用系统简体拼音在段落中组词 | 候选窗是否贴近光标；滚动后再试一次 |
| B5 | 复制真实图片后粘贴 | PNG 是否落盘、Markdown 引用、预览是否可见 |
| B6 | 触发缺目录的图片粘贴 | 「Create the image folder?」文案；点 Cancel 后文档与磁盘是否都没变 |
| B7 | 设置里分别用自定义目录和 `${filename}` 各粘一次 | 两次落点是否符合预期 |
| B8 | 改文档不保存，从 Finder 打开另一文件 | 选 Cancel / Discard 后最终文档 |
| B12 | 长文连打、滚动、选词 | 手感是否跟手 |
| B13 | 投递 `chmod 000` 的文件 | 状态栏消息是否清晰可读。链路已由代码确认：投递→消费正常、`load_document` 的 `Err` 分支产生 `Open failed: ...`、`chrome.rs:911` 的渲染条件不排除它 |

按 brief 第 4 检查点「实机证据缺项时保持待交付」，G004 在 B 类完成前**不标记完成**。

### 两条自动取证路径已试过，均不可用

想让代理直接取证 B13，两条路都因环境限制失败，不是应用缺陷：

| 路径 | 结果 |
|---|---|
| `screencapture -x` 截图 | 产出 PNG 尺寸正常但**内容全黑** —— 无屏幕录制权限 |
| 辅助功能 API（`System Events` 读 `static text`） | `count of windows` 为 **0**，唯一可见元素是 `AXMenuBar` —— GPUI 未暴露辅助功能树 |

不要重复尝试这两条。B 类只能由人在真机上完成。

## 未实现

### 2,000 段性能达标

门槛 p95 ≤45 ms 是**用户亲自确定的验收标准**（需求记录标记 `[from-user]`：第 2 轮检验「42 ms 是否可以交付」后定为 45 ms），不是 33 ms 的机械外推，因此不能靠复核门槛关闭。

根因（CPU 采样证据）：每次按键触发**两次完整 Markdown 解析**——渲染树 21.4 ms + `inline_marks` 18.6 ms（2,000 段）。非空闲样本几乎全部落在 `markdown` crate 的 tokenizer，绘制路径未进前 10。

A/B 实测：去掉第二次解析后 2,000 段 p50 从 65.11 降到 45.57 ms，仍贴线。所以达标必须同时消除两次解析。

方案（**未实现**）：增量解析四阶段——变更定位 → 结构安全判定（表格/列表/引用/围栏/链接与脚注定义一律回退全文）→ 局部重解析含 leaf key 平移 → 绘制侧签名比对自动收敛。验收要求：随机 200 步编辑后 `blocks`/`block_ranges`/`leaf_spans`/`inline_marks` 与全文解析逐字段相等；止损判据是若走增量的编辑占比 <50% 则停止并记录结论。

### 测试名与矩阵 ID 对齐

约 30 个测试的名字不含矩阵 ID，导致审阅者无法反查。重命名属独立清理，不在本次范围。
