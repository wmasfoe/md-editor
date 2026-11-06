# WYSIWYG 文末虚拟空行与 HTML 块源码展开规范

> 状态：CodeMirror 6 当前生效契约（PR #220，`fix/html-source-editing`）。单测、浏览器 e2e 与变异验证见文末「验证与回归防护」。

## 用途

记录两块互相咬合的行为契约：

1. **文末虚拟空行（Virtual Trailing Line）**：文档以整行块级替换的块（表格 / HTML 块 / 分割线 / MDX / Frontmatter / setext 标题）结尾时，块下方没有任何 `.cm-line` 可供落光标。虚拟空行是一个**只存在于展示层、不写入文档**的占位行，让用户能在块下继续书写，同时保证不污染磁盘文件。
2. **HTML 块的源码展开**：HTML 块如何进入、退出源码态，以及它与虚拟空行共用同一个光标偏移（`doc.length`）时谁拥有光标。

触发阅读的改动范围（任一命中即必须先读本规范）：

- `packages/renderer-codemirror/src/wysiwyg/editing/virtual-trailing-line.ts`（虚拟空行的**唯一实现来源**）；
- `packages/renderer-codemirror/src/wysiwyg/projections/html-projection.ts`（HTML 块的展开 / 折叠 / 快捷键）；
- `packages/renderer-codemirror/src/wysiwyg/state/projection-field.ts` 中的 `selectionActivatesRecord` / `virtualTrailingLineOwnsDocumentEnd`；
- `packages/renderer-codemirror/src/wysiwyg/widgets/html-block-widget.ts`（预览挂载与点击行为）；
- 任何新增「整行块级 widget」且可能出现在文末的改动（需判断是否加入 `TERMINAL_BLOCK_KINDS`）；
- 任何在文档末尾派发选区、插入换行或改写 `virtualTrailingLineActiveField` 的改动。

与整行块级替换的 Inclusivity 契约配套阅读：[thematic_break_and_block_inclusivity_spec.md](./thematic_break_and_block_inclusivity_spec.md)。虚拟空行存在的根因正是该规范中「整行替换会吞掉自己下方的那一行」。

---

## 缺陷背景与现象

### 症状

文档以表格或 HTML 块结尾时，用户无法在块下方新起一行：

- 光标只能停在块内或被原子选中；
- 想继续写字只能先切到源码模式补换行；
- 即使能把光标放到块末端，键入的第一个字符会**被写进块里**（表格会多出一行，HTML 预览会塌成源码）。

### 根因

整行块级替换装饰覆盖到 `trailingLineBreakEnd(record)`，会把块后紧随的一个换行一并吞掉。当该偏移等于 `doc.length` 时，块下方在 DOM 里**没有任何 `.cm-line`**，光标没有可落脚的行。

更隐蔽的一点：块的 `fullRange.to` 与「文档末尾」是**两个不同的偏移**。

| 文档（`\n` 为尾随换行） | `record.fullRange.to` | `doc.length` |
| --- | --- | --- |
| `\| 1 \| 2 \|`（无尾随换行） | 等于 `doc.length` | 同左 |
| `\| 1 \| 2 \|\n`（一个尾随换行） | 比 `doc.length` 小 1 | 大 1 |

只有带尾随换行时二者才分开，而绝大多数真实文件都以换行结尾。把光标停在 `fullRange.to`，用户键入的字符会落在块的最后一行**末尾**，被解析进块。实测对比（表格结尾，光标停靠后键入 `x`）：

| 光标停靠位置 | 结果 | 文档 |
| --- | --- | --- |
| `record.fullRange.to`（旧） | `x` 变成表格的一行（tbody 2 行） | `\| 1 \| 2 \|\nx` |
| `doc.length` + 虚拟空行（新） | `x` 成为表格下方的独立段落（tbody 1 行） | `\| 1 \| 2 \|\n\nx` |

HTML 块更严重：光标停在 `fullRange.to` 时，该偏移落在 HTML 块的闭区间内，预览会塌成源码（widget 0 个，源码行 1 行）；停在 `doc.length` 则预览保持。

---

## 核心不变量与设计契约

### A. 虚拟空行本体

1. **零磁盘污染**：虚拟空行只是展示层 widget。点亮、取消、来回切换都不得改变 `state.doc`。保存、导出、快照一律以用户原始内容为准。
2. **精准挂载（Deterministic Gating）**：只在「`TERMINAL_BLOCK_KINDS` 中的块，其 `trailingLineBreakEnd` 等于 `doc.length`」时挂载。
   - 普通段落末行**不挂载**：它有原生行尾光标，点击文末空白只是续写当前段，不是新起一行。
   - 文末已有真实空行时不挂载（`\n\n` 结尾）。
   - 源码模式、空文档不挂载。
   - 判定与物化前缀共用一个函数 `coversDocumentEnd`，两处不得各写一份。
3. **光标落点是 `doc.length`，不是 `record.fullRange.to`**：任何「离开文末原子块」的动作（ArrowDown 离开整块、折叠 HTML 源码、点击文末留白）都把光标放到 `doc.length`，并同时点亮虚拟空行。这条是本规范最重要的一条，原因见上文「根因」。
4. **激活态以「虚拟行此刻会不会出现」为准**：只有 `needsVirtualTrailingLine(state)` 为真时才允许把 `virtualTrailingLineActiveField` 置为 `true`。

   > 反例（已修复，见「踩坑记录」）：光标移出文末的注释块（`<!-- -->`）时无条件点亮虚拟行。注释块不在 `TERMINAL_BLOCK_KINDS` 里，文末根本没有虚拟行可显示，激活态却为真，虚拟行的高优先级键位会吞掉 Enter / Backspace / Delete，用户被困在文末。

5. **激活态的生命周期**：`virtualTrailingLineActiveField` 在文档变更，或主选区离开 `doc.length` 时自动清除；显式 `setVirtualTrailingLineActiveEffect` 优先于自动清除。

### B. 虚拟空行上的按键

虚拟空行激活时（高优先级键位 `Prec.highest`）：

| 按键 | 行为 | 文档 |
| --- | --- | --- |
| `Enter` | 接管但不写入换行 | 不变 |
| `Backspace` / `Delete` | 接管，什么都不做 | 不变 |
| `ArrowUp` / `ArrowLeft` | 回到上一块：前一个块被原子选中，否则光标回到最后一行行首 | 不变 |
| `Escape` | 取消激活 | 不变 |
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

### D. HTML 块的源码展开与折叠

1. **进入源码**只有三条路径：双击预览、点「编辑源码」按钮、整块原子选中态下按 `Mod-Enter`。**方向键只做原子选中，不展开源码**（与表格、图片一致）。
2. **折叠**：源码态下 `Mod-Enter` 或 `Escape`。
   - 块后还有内容：光标落到 `record.fullRange.to + 1`。
   - 块贴在文末：光标落到 `doc.length`，并按 A.4 决定是否点亮虚拟行，文档不变。
3. **注释块（`CommentBlock`）**不是可渲染 HTML：不进入预览 widget，保留源码并加弱化行样式。光标在注释块内按 `Mod-Enter` / `Escape` 把光标移出且不改文档——否则浏览器默认的 `Mod-Enter` 会插入换行，下一次撤销撤掉的是这行空行，而不是刚键入的文本。
4. **预览内点击**：
   - 点击预览里的链接：安全目标（`isSafeLinkTarget`）交给宿主打开；不安全或无 `href` 时点击被消费、阻止默认行为，**不冒泡、不选中整块**。
   - 其他交互元素（`button` / `summary` / `input` / `textarea` / `select` / `label`）保留浏览器默认行为，不选中整块。
   - 点击非交互内容与工具栏区域：原子选中整块。
5. **预览挂载**：清洗后的字符串再经 `DOMParser` 重建节点，**不使用 `innerHTML`**。重建时丢弃 `script` / `iframe` / `object` / `embed`、所有 `on*` 属性、`href` / `src` 中 `javascript:` / `vbscript:` 开头的值（先 `trim`，大小写不敏感）。没有 `DOMParser` 的宿主退化为纯文本，绝不回退到 `innerHTML`。这是字符串清洗之后的第二层纵深防御，不替代白名单清洗。

### E. 虚拟行与 HTML 块谁拥有 `doc.length` 的光标

HTML 块贴在文末（无尾随换行）时，块的闭区间右端点与虚拟空行的光标是同一个偏移。规则（`virtualTrailingLineOwnsDocumentEnd`）：

- 同时满足「虚拟行激活」「主选区是空光标」「光标在 `doc.length`」「记录 `fullRange.to >= doc.length`」时，该光标**属于虚拟行**，HTML 块**不展开**源码；
- 虚拟行激活态在**同一事务**内读取（先看本事务的 `setVirtualTrailingLineActiveEffect`，再看字段旧值），否则投影字段早于虚拟行字段更新时会按旧状态判断，出现一帧闪烁；
- 只豁免停在文末的那个光标。多光标时，另一个光标若在块内，仍然展开源码，否则用户看不到自己正在编辑的文本；
- 范围选区、不在文末的光标不受影响。

---

## 踩坑记录

1. **光标停在 `fullRange.to` 的静默错误**（根因分析的主体）：这个位置在无尾随换行的文档里与 `doc.length` 相等，所以只测无尾随换行的文档永远测不出来。**任何涉及文末光标的测试都必须带尾随换行，并前置断言 `record.fullRange.to < doc.length`**，否则测试对这条契约没有区分力。
2. **折叠 HTML 注释时无条件点亮虚拟行**：初版 `collapseHtmlSource` 在 `atDocumentEnd` 时一律把激活态置为 `true`。对 HTML 块成立，对注释块不成立（A.4）。症状是文末按 Enter 没有反应。由写测试时的 e2e 探针发现，回归见 `VTL-09` 与 `html-block-widget.test.ts` 的 "leaving a comment at EOF"。
3. **jsdom 里 Backspace / Delete 的键位绑定观察不到差别**：文末的删除同时会被 `wysiwygChangeProtection` 拦下，去掉虚拟行对这两个键的绑定，文档与事务数都不变。绑定的真实作用是避免触发「需要切换源码模式」的提示，jsdom 测不到。对应单测只守「文档不变」不变量，且在用例旁注明了覆盖范围；`Enter` 的绑定有区分力（需装 `defaultKeymap`），单独成例。
4. **只翻转虚拟行标志、光标没动的事务**：`ArrowDown` 场景 2 与 `Escape` 只派发 `setVirtualTrailingLineActiveEffect`，不带选区。投影字段在无选区、无文档变更的事务上走「`!transaction.selection` 则沿用旧投影」的快速路径，不重算 `activeSyntaxIds`。实测此时 HTML 块仍保持展开源码（widget 0 / 源码行 1），虚拟行 `--active` 同时亮起。这是**已知的待确认行为**：光标已在 `doc.length` 且贴文末的 HTML 块被展开后，再按 ArrowDown 只是多出一条虚拟行，预览不会折叠。是否要在这类事务上重算投影，需要产品确认后另开任务，本规范不改动现状。
5. **`defaultPrevented` 不能用来判断「没接管粘贴」**：CM6 自带的 `paste` 处理器对空剪贴板也会 `preventDefault`。判断虚拟行是否接管，要看文档与激活态，不能看事件。

---

## 验证与回归防护

### 单元测试（`packages/renderer-codemirror/tests/wysiwyg/`）

- `virtual-trailing-line.test.ts`：挂载判定、零污染、前缀规则、ArrowDown 光标落点（table / html / thematic-break 参数化，带尾随换行并前置断言偏移不等）、激活态按键（Enter / Backspace / Delete / ArrowLeft 参数化 / Escape）、未激活时放行、物化事务与一次撤销、粘贴（纯文本 / 富文本转换 / Shift / 空剪贴板 / 未激活）、组字（开始 / 取消回收 / 已上屏保留 / 文档已变放弃回收）、点击留白。
- `html-projection.test.ts`：虚拟行持有文末光标时的展开 / 折叠判定（含读取同一事务 effect、多光标、范围选区、光标不在文末）、注释块弱化渲染。
- `widgets/html-block-widget.test.ts`：预览链接点击（安全 / 不安全 / 无 `href` / 不冒泡 / 不选中）、`DOMParser` 重建（`script` / `iframe` / `object` / `embed`、`on*`、`javascript:` / `vbscript:` / 前导空格、普通属性与嵌套保留、无 `DOMParser` 退化）、源码横幅点击与非主键、注释块文末 Escape。

### 浏览器 e2e（`apps/desktop/e2e/`）

- `codemirror-virtual-trailing-line.spec.ts`：`VTL-01` ~ `VTL-10`。其中 `VTL-07`（离开文末表格后键入成为独立段落）、`VTL-08`（Enter / Backspace / Delete 文件字节不变）、`VTL-09`（文末注释不困住光标）、`VTL-10`（富文本粘贴落为 Markdown）是本规范的核心行为。
- `wysiwyg-block-blank-line-fidelity.spec.ts`：文末表格 ArrowDown 离开后光标落在 `doc.length` 且虚拟行激活；表格后还有正文时仍折叠到 `record.fullRange.to`（旧契约在非文末场景下依然成立）。

### 变异验证

写完测试后逐项破坏实现，确认测试会失败（而不只是「通过」）。已验证会被拦住的破坏包括：光标改回 `record.fullRange.to`、折叠后无条件点亮虚拟行、不读本事务 effect、虚拟行不再拥有文末光标、Shift 粘贴也做转换、粘贴不转换、组字取消不回收、组字回收不检查文档是否已变、`ArrowLeft` 不回上一块、未激活时接管 `Backspace` / `Delete` / `ArrowLeft`、`javascript:` 不校验、`vbscript:` 不剔除、前导空格不 `trim`、`iframe` 不剔除、无 `DOMParser` 不退化、点击不吞掉 / 仍冒泡、横幅点击不挪光标、非主键也触发。

仍**未覆盖**（等价变异，已确认无法被现有夹具区分，不是遗漏）：

- 「范围选区也算虚拟行持有」「光标不在文末也算虚拟行持有」两个变异体在 `projection-field.ts` 的 `virtualTrailingLineOwnsDocumentEnd` 内不会改变结果，因为外层 `selectionActivatesRecord` 已经用 `from === to` 与 `from === state.doc.length` 预先限定。该函数只有这一个调用点；若将来出现第二个调用点，需补对应单测。

### 改动前后必跑

- `pnpm --filter @md-editor/renderer-codemirror test`
- `pnpm --filter @md-editor/desktop exec playwright test e2e/codemirror-virtual-trailing-line.spec.ts e2e/wysiwyg-block-blank-line-fidelity.spec.ts e2e/codemirror-m4-html-mdx.spec.ts`
- 桌面专属行为（真实 Tauri 窗口里的 IME 组字、原生菜单）E2E 覆盖不到，只能手测；不得把「Chromium e2e 全绿」说成「桌面端已验证」。

---

## 范围外（未做）

- 非文末的块后输入（块后已有真实内容时，沿用既有「折叠到 `record.fullRange.to`」契约，不引入虚拟行）；
- 引用块 / 列表内的块结尾（`TERMINAL_BLOCK_KINDS` 只匹配顶层记录）；
- Mermaid 块：其装饰仍是手写 `inclusive: false`（见 Inclusivity 规范「已登记豁免」），不在 `TERMINAL_BLOCK_KINDS` 中，文末的 Mermaid 暂无虚拟行。
