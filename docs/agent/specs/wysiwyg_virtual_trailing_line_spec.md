# WYSIWYG 文末虚拟空行规范

> 状态：CodeMirror 6 当前生效契约（PR #220、`fix/virtual-trailing-line-duplicate-row`）。单测、浏览器 e2e 与变异验证见文末「验证与回归防护」。

## 用途

记录文末虚拟空行（Virtual Trailing Line）的行为契约：文档以整行块级替换的块（表格 / HTML 块 / 分割线 / MDX / Frontmatter / setext 标题 / 插件面板，以及引用 / 列表容器）结尾时，块下方需要一个**只存在于展示层、不写入文档**的占位行，让用户能在块下继续书写。

触发阅读的改动范围（任一命中即必须先读本规范）：

- `packages/editor/src/wysiwyg/editing/virtual-trailing-line.ts`（虚拟空行的**唯一实现来源**）；
- `packages/editor/src/wysiwyg/state/projection-field.ts` 中的 `virtualTrailingLineOwnsDocumentEnd`；
- 任何新增「整行块级 widget」且可能出现在文末的改动（需检查核心 kind 或插件 `directive-panel` 契约）；
- 任何在文档末尾派发选区、插入换行或改写 `virtualTrailingLineActiveField` 的改动。

配套规范：

- [CM6 块级 widget 的文末落脚行规范](./codemirror_block_widget_trailing_row_spec.md)：为什么虚拟行要复用 CM6 在文末合成的那一行、四种自己造行的做法为何都被否决，以及构建器的补行机制；
- [HTML 块源码展开与预览规范](./html_block_source_reveal_and_preview_spec.md)：HTML 块与虚拟行共用 `doc.length` 光标时谁拥有它；
- [整行块级替换 Inclusivity 规范](./thematic_break_and_block_inclusivity_spec.md)：虚拟行存在的根因是整行替换会吞掉自己下方的那一行。

---

## 缺陷背景与现象

文档以表格或 HTML 块结尾时，用户无法在块下方新起一行：光标只能停在块内或被原子选中；想继续写字只能先切到源码模式补换行；即使能把光标放到块末端，键入的第一个字符也会**被写进块里**。

### 根因

整行块级替换装饰覆盖到 `trailingLineBreakEnd(record)`，会把块后紧随的一个换行一并吞掉。当该偏移等于 `doc.length` 时，块下方没有文档自己的行。CM6 会合成一个空 `.cm-line` 顶上，但它**不是安全的落脚点**，原因见上述「块级 widget 的文末落脚行规范」。

块的 `fullRange.to` 与「文档末尾」是**两个不同的偏移**：

| 文档（`\n` 为尾随换行） | `record.fullRange.to` | `doc.length` |
| --- | --- | --- |
| `\| 1 \| 2 \|`（无尾随换行） | 等于 `doc.length` | 同左 |
| `\| 1 \| 2 \|\n`（一个尾随换行） | 比 `doc.length` 小 1 | 大 1 |

只有带尾随换行时二者才分开，而绝大多数真实文件都以换行结尾。把光标停在 `fullRange.to`，用户键入的字符会落在块的最后一行**末尾**，被解析进块。实测（表格结尾，光标停靠后键入 `x`）：

| 光标停靠位置 | 结果 | 文档 |
| --- | --- | --- |
| `record.fullRange.to`（旧） | `x` 变成表格的一行（tbody 2 行） | `\| 1 \| 2 \|\nx` |
| `doc.length` + 虚拟空行（新） | `x` 成为表格下方的独立段落（tbody 1 行） | `\| 1 \| 2 \|\n\nx` |

---

## 核心不变量与设计契约

### A. 虚拟空行本体

1. **零磁盘污染**：虚拟空行只是展示层 widget。点亮、取消、来回切换都不得改变 `state.doc`。保存、导出、快照一律以用户原始内容为准。
2. **精准挂载（Deterministic Gating）**：只在核心文末块（含引用 / 列表）或 `directive-panel` 插件块的 `trailingLineBreakEnd` 等于 `doc.length` 时挂载。
   - 普通段落末行**不挂载**：它有原生行尾光标，点击文末空白只是续写当前段，不是新起一行。
   - 文末已有真实空行时不挂载（`\n\n` 结尾）。
   - 源码模式、空文档不挂载。
   - 判定与物化前缀共用一个函数 `coversDocumentEnd`，两处不得各写一份。
3. **光标落点是 `doc.length`，不是 `record.fullRange.to`**：任何「离开文末原子块」的动作（ArrowDown 离开整块、折叠 HTML 源码、点击文末留白）都把光标放到 `doc.length`，并同时点亮虚拟空行。这条是本规范最重要的一条，原因见上文「根因」。
4. **激活态以「虚拟行此刻会不会出现」为准**：只有 `needsVirtualTrailingLine(state)` 为真时才允许把 `virtualTrailingLineActiveField` 置为 `true`。

   > 反例（已修复）：光标移出文末的注释块（`<!-- -->`）时无条件点亮虚拟行。注释块不在 `TERMINAL_BLOCK_KINDS` 里，文末根本没有虚拟行可显示，激活态却为真，虚拟行的高优先级键位会吞掉 Enter / Backspace / Delete，用户被困在文末。

5. **激活态的生命周期**：`virtualTrailingLineActiveField` 在文档变更，或主选区离开 `doc.length` 时自动清除；显式 `setVirtualTrailingLineActiveEffect` 优先于自动清除。
6. **块下方只能有一个落脚行，并且它就是 CM6 在文末合成的那一行**：虚拟行用 `Decoration.line` 在 `doc.length` 给合成行加 `cm-virtual-trailing-line` class，不自己造行。光标由 CM6 画在这一行里。块的最后一行是它自己的真实文本行时（Frontmatter 闭合 `---` 无尾随换行，或 HTML 块被展开成源码），没有合成行可复用，改用一个 `side: 1` 的占位块 widget。机理、四种被否决的写法与 tile 树实测见「块级 widget 的文末落脚行规范」。文档自带空行（`\n\n` 结尾）时不挂载虚拟行，落脚行就是文档里的那个空行。
7. **激活态跟着光标走，只看结果**：任何事务结束时，只要光标站在虚拟空行上（`caretRestsOnVirtualTrailingLine`：唯一空光标、在 `doc.length`、此处需要虚拟行），虚拟行就是激活的（`armVirtualTrailingLineOnCaret`，`EditorState.transactionExtender`）。不区分事务来源：点击、ArrowDown、Cmd/Ctrl+End、Cmd/Ctrl+ArrowDown、程序化设置选区、撤销物化后光标回到文末，结果都一样。熄灭不单独处理：光标离开 `doc.length` 即自然熄灭（A.5）。

   > 为什么必须这样：物化处理器只在激活态接管键入。激活态没亮时光标停在 `doc.length` 打字，浏览器把字写进合成行，解析器把它当作块的延续，表格会多出一行。实测会让光标停在文末却不点亮的路径就有 Cmd/Ctrl+End、撤销物化、按 Escape 三条。
   >
   > 可编辑内容的例外：HTML 源码、插件面板、引用 / 列表容器没有尾随换行时，此时 `doc.length` 是源码闭区间的右端点，光标在这里是在编辑源码，不点亮虚拟行，否则源码会被收起。点击虚拟行本身仍会显式点亮（`isClickOnVirtualTrailingLine`），表达的是「我要在块下面写东西」。

### B. 虚拟空行上的按键

虚拟空行激活时（高优先级键位 `Prec.highest`）。`Escape` **不再**取消激活：光标没离开虚拟行，激活态就保持（A.7），按 Escape 后再打字仍写在块下方。

| 按键 | 行为 | 文档 |
| --- | --- | --- |
| `Enter` | 接管但不写入换行 | 不变 |
| `Backspace` / `Delete` | 接管，什么都不做 | 不变 |
| `ArrowUp` / `ArrowLeft` | 回到上一块：前一个块被原子选中，否则光标回到最后一行行首。这是取消激活的方式 | 不变 |
| 可打印字符 / 粘贴 / 组字开始 | 物化（见 C） | 写入 |

**未激活时这些键必须放行**，否则正文末尾的 Backspace 会失灵。键位绑定的返回值就是「是否接管」。

**两条 Enter 路径不要混淆**：

- 虚拟行**已激活**时按 `Enter`：不写入换行（虚拟行本身就是一个空行，再写一个换行会让干净文件多出空行）。
- 文末块处于**原子选中态**时按 `Enter`（`exitAtomAtEndOfDocument`）：**写入**必要的前导换行并在块下方开出真实的新行。这是用户明确表达「我要在块下面写东西」，e2e `VTL-03` 守这一条。

### C. 物化（Materialization）

虚拟空行上第一次产生文本输入时，把虚拟行变成真实文档行。

1. **唯一入口**：`materializeVirtualTrailingLine(view, inserted, userEvent)`。键入、粘贴、组字开始都走它，不得各自手写事务。
2. **前缀与正文同一事务**：前导换行与正文一起写入，一次 `undo` 全部撤回，不会留下孤立的空行。
3. **前缀规则**（`calculateMaterializationPrefix`）：
   - 块后：已有 `\n\n` → `""`；已有一个 `\n` → `"\n"`；否则 `"\n\n"`。块与正文之间必须保留一个 Markdown 空行，否则紧随文本会被解析器吸收进块。
   - 普通文本行后：已有 `\n` → `""`；否则 `"\n"`。
4. **粘贴**：先经智能粘贴的 HTML→Markdown 转换（与普通位置的粘贴一致），按住 `Shift` 保持纯文本，剪贴板为空不物化。用 `Prec.highest` 的 `paste` 处理器，保证先于 CM6 默认处理。
5. **IME 组字**：
   - `compositionstart` 时先物化前导换行（组字需要真实 DOM 选区），用 `input.type.compose.start`，后续组字事务会并进同一次撤销。
   - `compositionend` 时若没有上屏文字（取消组字），**且文档仍恰好停在前缀末尾**，撤掉预写入的前导换行并重新点亮虚拟行。
   - 组字期间文档已被改动时放弃回收，宁可多留一个换行，也不误删用户内容。
6. **点击留白**：点击最后一行（含虚拟行）下方的编辑器下内边距，光标落到文末；虚拟行存在时命中的就是虚拟行。点击内容列左右两侧、点击最后一行本身都不算文末留白。选区移动不进撤销栈。

---

## 踩坑记录

1. **光标停在 `fullRange.to` 的静默错误**：这个位置在无尾随换行的文档里与 `doc.length` 相等，所以只测无尾随换行的文档永远测不出来。**任何涉及文末光标的测试都必须带尾随换行，并前置断言 `record.fullRange.to < doc.length`**，否则测试对这条契约没有区分力。通用方法见 [编辑器交互测试的区分力规范](./editor_interaction_test_discriminating_power_spec.md)。
2. **折叠 HTML 注释时无条件点亮虚拟行**：初版 `collapseHtmlSource` 在 `atDocumentEnd` 时一律把激活态置为 `true`。对 HTML 块成立，对注释块不成立（A.4）。症状是文末按 Enter 没有反应。回归见 `VTL-09` 与 `html-block-widget.test.ts` 的 "leaving a comment at EOF"。
3. **jsdom 里 Backspace / Delete 的键位绑定观察不到差别**：文末的删除同时会被 `wysiwygChangeProtection` 拦下，去掉虚拟行对这两个键的绑定，文档与事务数都不变。绑定的真实作用是避免触发「需要切换源码模式」的提示，jsdom 测不到。对应单测只守「文档不变」不变量，且在用例旁注明了覆盖范围；`Enter` 的绑定有区分力（需装 `defaultKeymap`），单独成例。
4. **只翻转虚拟行标志、光标没动的事务**：`ArrowDown` 场景 2 只派发 `setVirtualTrailingLineActiveEffect`，不带选区。投影字段在无选区、无文档变更的事务上走「`!transaction.selection` 则沿用旧投影」的快速路径，不重算 `activeSyntaxIds`。实测此时 HTML 块仍保持展开源码，虚拟行同时亮起。现已修复：虚拟行激活 effect 参与投影刷新，源码随进入落脚行折叠。（`Escape` 原本也属于这一类，已随 A.7 移除。）
5. **`defaultPrevented` 不能用来判断「没接管粘贴」**：CM6 自带的 `paste` 处理器对空剪贴板也会 `preventDefault`。判断虚拟行是否接管，要看文档与激活态，不能看事件。
6. **表格 / HTML 下方出现两个空行**：虚拟行初版是普通 `block widget`，CM6 另补了一个空 `.cm-line`，表格结尾的文档下方是「空行 + 虚拟行」。起因是凭代码注释推断「块下方没有 `.cm-line`」而没有在页面上量。
7. **修两个空行时又把光标落点弄坏了**：第一版修复改用零长度两端 inclusive 的 `replace` 吃掉合成行，块下方只剩一行，CI 全绿，但 Cmd/Ctrl+End 后键入的字写到块的**前面**。原因是合成行是文末唯一的文本 tile，吃掉它之后 CM6 写 DOM 选区时找不到落点。这次是只看了「`.cm-content` 有几个子节点」，没看 tile 树，也没测 Cmd/Ctrl+End。由 PR 评审「留意键盘导航」的建议触发排查。回归见 e2e `VTL-12`。
8. **激活态曾只在点击 / ArrowDown 时点亮**：Cmd/Ctrl+End、撤销物化、按 Escape 都会让光标停在文末而虚拟行不亮，键入直接并进块。这个缺口在 #220 合并时就存在。修法是 A.7。

---

## 验证与回归防护

### 单元测试（`packages/editor/tests/wysiwyg/virtual-trailing-line.test.ts`）

挂载判定、零污染、前缀规则、ArrowDown 光标落点（table / html / thematic-break 参数化，带尾随换行并前置断言偏移不等）、块下方只有一个落脚行（6 种整行替换文末块 + MDX / Frontmatter 4 条 + 2 种文档自带空行）、激活态按键（Enter / Backspace / Delete / ArrowLeft 参数化）、Escape 不熄灭、未激活时放行、物化事务与一次撤销、粘贴（纯文本 / 富文本转换 / Shift / 空剪贴板 / 未激活）、组字（开始 / 取消回收 / 已上屏保留 / 文档已变放弃回收）、点击留白。

新增 `virtual-terminal-blocks.test.ts` 覆盖插件、引用 / 列表内嵌套块、投影 effect-only 刷新、容器外独立段落及撤销。

### 浏览器 e2e（`apps/desktop/e2e/`）

- `codemirror-virtual-trailing-line.spec.ts`：`VTL-01` ~ `VTL-14`。核心行为：`VTL-07`（离开文末表格后键入成为独立段落）、`VTL-08`（Enter / Backspace / Delete 文件字节不变）、`VTL-09`（文末注释不困住光标）、`VTL-10`（富文本粘贴落为 Markdown）、`VTL-11`（块下方只有一个落脚行：表格 0 / 1 / 2 个尾随换行、分割线）、`VTL-12`（5 种文末块 × Cmd/Ctrl+End / Cmd/Ctrl+ArrowDown / 程序化选区 / 撤销物化，键入落在块下方）、`VTL-13`（Escape 后键入不进表格）、`VTL-14`（光标画在虚拟行内）。
- `codemirror-terminal-blocks.spec.ts`：真实 Mermaid 插件及引用 / 列表的落脚行点击、首次输入、撤销和源码 ArrowDown 折叠。
- `wysiwyg-block-blank-line-fidelity.spec.ts`：文末表格 ArrowDown 离开后光标落在 `doc.length` 且虚拟行激活；表格后还有正文时仍折叠到 `record.fullRange.to`（旧契约在非文末场景下依然成立）。

### 变异验证

写完测试后逐项破坏实现，确认测试会失败。已验证会被拦住的破坏包括：光标改回 `record.fullRange.to`、折叠后无条件点亮虚拟行、虚拟行改回普通 widget、虚拟行改为零长度 replace（`VTL-12` 在该版本上失败）、Shift 粘贴也做转换、粘贴不转换、组字取消不回收、组字回收不检查文档是否已变、`ArrowLeft` 不回上一块、未激活时接管 `Backspace` / `Delete` / `ArrowLeft`、`Enter` 不接管。

### 改动前后必跑

- `pnpm --filter @md-editor/editor test`
- `pnpm --filter @md-editor/desktop exec playwright test e2e/codemirror-terminal-blocks.spec.ts e2e/codemirror-mermaid-viewer.spec.ts e2e/codemirror-virtual-trailing-line.spec.ts e2e/wysiwyg-block-blank-line-fidelity.spec.ts e2e/codemirror-m4-html-mdx.spec.ts`
- 桌面专属行为（真实 Tauri 窗口里的 IME 组字、原生菜单）E2E 覆盖不到，只能手测；不得把「Chromium e2e 全绿」说成「桌面端已验证」。

---

## 范围外（未做）

- 非文末的块后输入（块后已有真实内容时，沿用既有「折叠到 `record.fullRange.to`」契约，不引入虚拟行）；
- 段落结尾且没有尾随换行时是否渲染虚拟行：当前不渲染（普通段落有原生行尾光标）。**产品期望与此不同**——期望「末尾没有空行就渲染虚拟行」，待另开任务确认；
