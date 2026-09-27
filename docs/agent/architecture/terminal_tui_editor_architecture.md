# 终端 TUI 编辑器（vim 式）架构方案

用途：记录 `apps/tui`（inkpoint-tui）终端客户端的定位、分层、复用边界与演进路线。改动 TUI 渲染/编辑器内核，或评估「TUI 与桌面/Web 端共享内核」时先读本文。

状态：v1 已落地（95 个单测 + 伪终端冒烟验证通过），未发布、未接入发版链路。第二轮已做增量渲染性能优化（见 §6.1）。

## 1. 目标与定位

- 终端里编辑 Markdown/MDX，**vim 式全屏形态**：打开文件 → 接管视口 → 所见即所得渲染 → 状态栏显示模式/行列/文件 → `:wq` 退出。
- **同一个编辑器组件也能嵌进聊天框/任意壳子**：全屏只是「壳子 A」，组件本身不知道自己在哪、多大。
- 终端里不追求 100% 等价 CodeMirror 的排版能力：第一版冻结子集（浏览 + 基础编辑 + 大纲留待后续），先保证交互正确（CJK 光标、IME、undo、滚动）。

## 2. 硬规则（可嵌入性契约）

1. 编辑器组件实现 pi-tui `Component`：`render(width): string[]`，**只依赖传入宽度**；组件内绝不读 `process.stdout.columns`、绝不直接写 stdout。
2. 视口滚动由壳子决定：全屏壳子用 `ScrollView(primary: true)`；嵌入壳子用任意 `Container` 或固定高度区域。
3. 聚焦时在光标列输出 `CURSOR_MARKER`（pi-tui 的零宽 APC 序列），由 pi-tui 把硬件光标移过去 —— 这是终端 IME（fcitx/ibus/系统输入法）候选窗能对准光标的前提。
4. 行稳定：**1 渲染行 = 1 源码行**。光标列与源码列严格一致，CJK 双宽字符不会错位。块级重排（隐藏标记改变行数）留待引入 linenum 映射表后再做。

## 3. 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 缓冲区 | `apps/tui/src/buffer/piece-table.ts` | piece table（只读 original + 追加 add），增量维护行首索引，提供 offset ↔ (line, col) |
| 字素/列宽 | `apps/tui/src/buffer/graphemes.ts` | grapheme 分段（`Intl.Segmenter`）与显示列换算（宽度用 pi-tui `visibleWidth`，即 wcwidth 语义） |
| 文档模型 | `apps/tui/src/document/text-document.ts` | 光标（grapheme 下标）+ 编辑原语（插入/退格/删行）+ 版本号与 `takeEditFloor()`（渲染缓存增量失效用） |
| 撤销 | `apps/tui/src/document/history.ts` | operation 级 undo/redo，按「输入组」提交（`flush()` 由语义边界触发），回放期间不记录 |
| 键位 | `apps/tui/src/editor/keymap.ts` | 三模态（normal/insert/command）键位表 + 多键序列（`gg`/`dd`/`yy`）+ 括号粘贴；输入先经 `parseKey` 归一化（兼容 Kitty 协议） |
| 渲染 | `apps/tui/src/render/md-view.ts` + `theme.ts` | 块上下文扫描（标题/引用/列表/围栏/表格/前置元数据）+ 行内样式；光标行显示源码，其余行隐藏标记（live preview）；**增量失效 + 行样式缓存**（见 §6.1） |
| 组件 | `apps/tui/src/editor/md-editor.ts` | 把上面几层组装成 `Component`：命令分发、脏标记、保存/退出回调、行号栏、光标标记 |
| 壳子 | `apps/tui/src/shell/fullscreen.ts` + `statusbar.ts` | alt-screen + ScrollView + 状态栏；保存落盘、退出收尾、光标驱动滚动 |
| 入口 | `apps/tui/src/cli.ts` | argv 解析、TTY 守卫、信号处理 |

## 4. 关键设计决策

1. **渲染底座用 `@earendil-works/pi-tui`（MIT）**：一次拿到差分渲染、CSI 2026 同步输出、alt-screen + ScrollView（含鼠标滚轮/滚动条）、Kitty 协议按键解析、括号粘贴、IME 光标联动。这些自己写是 2~3 周且最容易踩坑。
2. **不用 pi 自带 `Editor`**：它是聊天 composer 定位（无选区、undo 粗粒度、buffer 是 `string[]`、长粘贴折叠成占位）。我们复用它的基础设施，自己写 buffer/光标/undo。
3. **不用 Ink / OpenTUI**：Ink 是 React 整树 reconcile + 拿不到 Kitty/IME 定位；OpenTUI 需要 Bun + Zig 构建链，且全屏路线与嵌入需求不匹配。
4. **第一版是「行稳定 live preview」而不是块级重排**：光标不在的行隐藏 `**`/`#`/`>` 等标记（看起来是渲染结果），光标所在行显示源码（保证列映射精确）。这是 v1 不引入 linenum 映射表就能同时拿到「所见即所得观感」和「零错位」的唯一办法。
5. **光标用 grapheme 下标 + 显示列双坐标**：逻辑移动按 grapheme，渲染/硬件光标按显示列；双宽字符内部不落光标（列落进去吸附到字符起点）。
6. **undo 按输入组**：连续击键合成一组（模式切换/光标移动/换行/保存/undo 本身触发 `flush()`），回放逆操作时暂停记录。
7. **空文档给占位提示行**（`按 i 开始输入 · :w 保存 · :q! 强制退出`），避免空白屏；且与 vim 一致，**默认 normal 模式**（空文档不会把首个 `i` 当文字插入）。
8. **保存不做隐式改写**：文件按缓冲区原样写回，不自动补结尾换行（与 VS Code `insertFinalNewline: false` 一致）。
9. **性能靠「内容键缓存」而不是视口裁剪**（第二轮实测后定调）：真正的热点不是 Markdown 样式计算，而是 `truncateToWidth` 解析 ANSI 算宽度 —— 800 行文档里它独占 17.8ms/帧（整帧 21ms）。所以做法是：块上下文与扫描状态按行缓存（编辑后从 `takeEditFloor()` 续扫）、行样式按「上下文 + 是否光标行 + 行内容」缓存、截断结果按「可用宽度 + 最终文本」缓存（**不含行号**，这样在文档顶部插行也不会整屏失效）。全程保留 `render(width)` 返回真实行数，不引入视口裁剪，pi-tui 的滚动条/搜索/复制等能力不受影响。

## 5. 复用边界（相对桌面/Web 端）

- 复用：`packages/editor-core`（纯逻辑，无 DOM）与 `packages/compiler`（自声明 headless）已列入依赖，后续接大纲/导出用。
- 不复用：`packages/renderer-codemirror`（DOM/CM6 强依赖）、`syntax-plugins/*-projection.ts`（依赖 `Decoration`/`WidgetType`）。终端侧需要重写投影，本模块的替代品就是 `render/md-view.ts`。
- 若后续要「三端解析一致 / 单二进制分发」，再抽 Rust 无状态纯函数内核（parse/render/toc/transform），TUI 走 Ratatui、Web 走 WASM、Tauri 直接依赖 —— 见对话中评估过的两步走方案；当前不做。

## 6. 运行与验证

```bash
# 运行（需要交互式终端；注意不要加 `--`，pnpm 11 会把字面量 `--` 当成文件路径传进去）
pnpm dev:tui README.md
# 等价写法
pnpm --filter @md-editor/tui dev README.md
cd apps/tui && pnpm dev README.md
cd apps/tui && npx tsx src/cli.ts README.md

# 构建产物（tsc → apps/tui/dist，可直接用 node 跑，不需要 tsx）
pnpm build:tui
node apps/tui/dist/cli.js README.md

# 单测 / 类型检查
pnpm --filter @md-editor/tui test
pnpm --filter @md-editor/tui typecheck
```

伪终端冒烟（无桌面环境也能跑，验证真实渲染 + 按键链路）：

```bash
cd apps/tui
{ sleep 2; printf 'i'; sleep 0.3; printf '# Hello '; printf '\xe4\xb8\xad\xe6\x96\x87'; printf '\r'; printf 'second line'; sleep 0.4; printf '\x1b'; printf ':wq\r'; sleep 1; } | \
  script -q -c "stty rows 24 cols 80; npx tsx src/cli.ts /tmp/smoke.md" /tmp/smoke.log
cat /tmp/smoke.md   # 期望: "# Hello 中文" + 换行 + "second line"
```

冒烟通过判据：日志里能看到 alt-screen 进出（`\x1b[?1049h/l`）、CSI 2026 同步输出、状态栏 `NORMAL`/`INSERT`、`已保存` 提示，且退出时文档被回印到主屏。

v1 验证记录：单测 84 个全绿；上述冒烟在本机（Debian 13 / aarch64）实测通过，含中文输入与光标定位。

### 6.1 增量渲染性能（第二轮）

每次击键的渲染成本模型（本机 2vCPU ARM 实测，`tests/perf-guard.test.ts` 用比值断言护栏）：

| 场景 | 优化前 | 优化后 |
| --- | --- | --- |
| 800 行（真实架构文档）单帧 | 21.4ms | **0.7ms** |
| 800 行一次击键（编辑 + 渲染） | 21.7ms | **1.7ms** |
| 8000 行单帧 | 218ms | **6.3ms** |
| 2000 行顶部编辑（上下文需从第 0 行续扫，最坏情况） | ~96ms | **4.8ms** |
| 1MB / 6 万行单帧 | 48.8ms | 31ms（仍偏慢，见限制） |

三层缓存与失效规则：

1. **块上下文 + 扫描状态**（`MdDocumentView`）：`scanBlockContexts` 同时返回每行之后的围栏/前置元数据状态；编辑后只从「最早被编辑的行」续扫（`TextDocument.takeEditFloor()` 取两次渲染之间的最小值，避免多次编辑只按最后一次失效而漏算）。
2. **行样式**（`MdDocumentView.lineCache`）：键 = 块上下文 + 是否光标行 + 行内容。上下文变化但内容相同时（如围栏开关）也会正确重渲。
3. **截断结果**（`MdEditor.truncateCached`）：键 = 可用宽度 + 最终文本。纯 ASCII 且长度不超可用宽度时直接跳过（显示宽度必然 <= 代码单元数），含 CJK/emoji 的行仍走 `truncateToWidth`。

失效由视图自己按 `doc.version` 同步（`syncVersion()`），调用方无需手动调用 `invalidateFrom`；`invalidate()` 仅用于主题变更/重新加载。

## 7. 已知限制 / 路线图

限制（v1 有意冻结）：

- 无横向滚动：超宽行按宽度截断（光标超出视口时标记落在末端）。
- 无鼠标点击定位、无文本选择：`render(width)` 层面行内标记隐藏会让非光标行列映射偏移；先只保留滚轮（ScrollView 自带）。
- 无语法高亮：代码块整行单色，`sugar-high` 依赖已装但未接（`render/highlight.ts` 待建）。
- 无选区/复制块、无 `yy` 多行、无 `w/b` 词移动、无搜索、无 `:e <path>`。
- 大文档仍有每帧 O(行数) 的固定开销（逐行取文本 + 拼缓存键）：800 行 0.7ms、8000 行 6.3ms 可接受，1MB/6 万行约 31ms/帧（打字有黏感）。若真要支撑超大文件，再上「视口裁剪」——只对可见窗口做真实渲染、窗口外返回占位行；代价是 pi-tui 内置的全文搜索/复制会看不到窗口外内容，需一并权衡。
- 保存不补结尾换行、未接入发版链路（`apps/tui` 目前只是 workspace 包，没有产物发布）。

路线图（按优先级）：

1. ~~增量渲染（块上下文续扫 + 行样式/截断缓存）~~ —— 已完成（§6.1）。
2. 代码块语法高亮（接 `sugar-high`，保留行稳定）。
3. `$/dx` 词移动、`w/b`、搜索 `/`。
4. 鼠标点击定位（需要 renderInline 产出「显示列 → 源码列」映射表）。
5. 块级重排的真 WYSIWYG（引入 linenum 映射表，隐藏块标记）。
6. 单二进制分发（`bun build --compile` 或 pkg），再评估是否抽 Rust 内核。
