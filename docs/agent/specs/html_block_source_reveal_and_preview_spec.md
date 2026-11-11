# HTML 块源码展开与预览规范

> 状态：CodeMirror 6 当前生效契约（PR #220）。单测与浏览器 e2e 见文末「验证与回归防护」。

## 用途

记录 WYSIWYG 模式下 HTML 块（`HTMLBlock` / `CommentBlock`）如何呈现预览、如何进入与退出源码态，以及它贴在文档末尾时与虚拟空行共用同一个光标偏移（`doc.length`）时谁拥有该光标。

触发阅读的改动范围（任一命中即必须先读本规范）：

- `packages/editor/src/wysiwyg/projections/html-projection.ts`（展开 / 折叠 / 快捷键 / 注释块）；
- `packages/editor/src/wysiwyg/widgets/html-block-widget.ts`（预览挂载与点击）；
- `packages/editor/src/wysiwyg/state/projection-field.ts` 中的 `selectionActivatesRecord` / `virtualTrailingLineOwnsDocumentEnd`；
- `packages/editor/src/wysiwyg/blocks/atom-selection.ts` 中 HTML 相关的方向键行为；
- `packages/editor/src/markdown/node-policy.ts` 中 `HTMLBlock` / `CommentBlock` 的策略。

配套规范：

- [WYSIWYG 文末虚拟空行规范](./wysiwyg_virtual_trailing_line_spec.md)；
- [整行块级替换 Inclusivity 规范](./thematic_break_and_block_inclusivity_spec.md)：HTML 块是整行块级替换，起点必须在行首、不得写 `inclusive: false`；
- [WYSIWYG 选区完整性规范](./wysiwyg_selection_integrity_spec.md)：原子选中、整块删除与 undo。

---

## 核心不变量与设计契约

### A. 进入与退出源码

1. **进入源码**只有三条路径：双击预览、点「编辑源码」按钮、整块原子选中态下按 `Mod-Enter`。**方向键只做原子选中，不展开源码**（与表格、图片一致）。
2. **折叠**：源码态下 `Mod-Enter` 或 `Escape`。
   - 块后还有内容：光标落到 `record.fullRange.to + 1`。
   - 块贴在文末：光标落到 `doc.length`，文档不变；是否点亮虚拟空行见下一条。
3. **折叠后是否点亮虚拟空行，以「虚拟行此刻会不会出现」为准**（`needsVirtualTrailingLine`），不是以「光标在文末」为准。折叠 HTML 块时文末通常确实有虚拟行；折叠注释块时没有。无条件点亮会让虚拟行的高优先级键位吞掉 Enter / Backspace / Delete，用户被困在文末。
4. **源码态的外观**：块上方一条横幅（`HTML` 标签与 `Esc` 提示），源码行加等宽字体、底色与左侧竖线。点击横幅把光标移到块首，只响应主键。

### B. 注释块（`CommentBlock`）

1. 注释是作者笔记，不是可渲染 HTML。策略为 `kind: "deferred-html"` / `renderPolicy: "deferred-raw"`：不进入预览 widget，保留源码并加弱化行样式（`cm-md-html-comment`）。若仍走 `html-widget`，清洗结果为空，会显示成「不安全 HTML」占位卡片。
2. 光标在注释块内按 `Mod-Enter` / `Escape` 把光标移出，**不改文档**。原因：行首键入 `<!--` 会把 HTML 块重新解析成 `CommentBlock`；若这时不接住按键，浏览器默认的 `Mod-Enter` 会插入换行，下一次撤销撤掉的是这行空行，而不是刚键入的文本。

### C. 预览内点击

- 点击预览里的链接：安全目标（`isSafeLinkTarget`）交给宿主 `openLinkTargetFacet` 打开；不安全或无 `href` 时点击被消费、阻止默认行为，**不冒泡、不选中整块**。
- 其他交互元素（`button` / `summary` / `input` / `textarea` / `select` / `label`）保留浏览器默认行为，不选中整块。
- 点击非交互内容与工具栏区域：原子选中整块。
- 「不冒泡」不是可有可无：CM6 自己的点击与选区处理挂在 `contentDOM` 上，链接点击若冒泡出去会被当成对文档的普通点击，把光标挪进块里并展开源码。

### D. 预览挂载与安全

1. 清洗后的字符串再经 `DOMParser` 重建节点，**不使用 `innerHTML`**。
2. 重建时丢弃：`script` / `iframe` / `object` / `embed`；所有 `on*` 属性；`href` / `src` 中以 `javascript:` / `vbscript:` 开头的值（先 `trim`，大小写不敏感）。
3. 没有 `DOMParser` 的宿主退化为纯文本，绝不回退到 `innerHTML`。
4. 这是字符串白名单清洗之后的**第二层纵深防御**，不替代白名单清洗（`markdown/html-sanitize.ts` / `html-whitelist.ts`）。白名单拒绝的结构（表单控件、`<table>` 等）仍显示占位卡片。

### E. HTML 块与虚拟空行谁拥有 `doc.length` 的光标

HTML 块贴在文末（无尾随换行）时，块的闭区间右端点与虚拟空行的光标是同一个偏移。规则（`virtualTrailingLineOwnsDocumentEnd`）：

1. 同时满足「虚拟行激活」「主选区是空光标」「光标在 `doc.length`」「记录 `fullRange.to >= doc.length`」时，该光标**属于虚拟行**，HTML 块**不展开**源码；
2. 虚拟行激活态在**同一事务**内读取（先看本事务的 `setVirtualTrailingLineActiveEffect`，再看字段旧值），否则投影字段早于虚拟行字段更新时会按旧状态判断，出现一帧闪烁；
3. 只豁免停在文末的那个光标。多光标时，另一个光标若在块内，仍然展开源码，否则用户看不到自己正在编辑的文本；
4. 范围选区、不在文末的光标不受影响。

> 该函数只有 `selectionActivatesRecord` 一个调用点，且外层已用 `from === to` 与 `from === state.doc.length` 预先限定。因此「范围选区也算虚拟行持有」「光标不在文末也算虚拟行持有」这两种破坏不会改变结果，单测无法也无需区分它们。若将来出现第二个调用点，需补对应单测。

---

## 踩坑记录

1. **`CommentBlock` 曾走 `html-widget`**：显示成「不安全 HTML」占位卡片。归类为 `deferred-raw` 后保留源码。
2. **折叠后无条件点亮虚拟行**：见 A.3。症状是文末注释块折叠后 Enter 没有反应。
3. **测试夹具默认把光标放在 `doc.length`**：贴文末的 HTML 块会因此展开成源码行，断言预览态的用例必须先把光标移进开头的正文。
4. **无尾随换行时 `fullRange.to === doc.length`**：测「光标在块末端」还是「在文档末尾」要带尾随换行才区分得开，见 [编辑器交互测试的区分力规范](./editor_interaction_test_discriminating_power_spec.md)。

---

## 验证与回归防护

### 单元测试（`packages/editor/tests/wysiwyg/`）

- `html-projection.test.ts`：虚拟行持有文末光标时的展开 / 折叠判定（含读取同一事务 effect、多光标、范围选区、光标不在文末）、注释块弱化渲染。
- `widgets/html-block-widget.test.ts`：预览链接点击（安全 / 不安全 / 无 `href` / 不冒泡 / 不选中）、`DOMParser` 重建（`script` / `iframe` / `object` / `embed`、`on*`、`javascript:` / `vbscript:` / 前导空格、普通属性与嵌套保留、无 `DOMParser` 退化）、源码横幅点击与非主键、注释块文末 Escape。
- `atom-selection.test.ts`：方向键只选中相邻 HTML 块，不展开源码。

### 浏览器 e2e（`apps/desktop/e2e/`）

- `codemirror-m4-html-mdx.spec.ts`：HTML / MDX 渲染与原子选择。
- `codemirror-virtual-trailing-line.spec.ts` 的 `VTL-09`：文末注释不困住光标。

### 变异验证

已验证会被拦住的破坏：`javascript:` 不校验、无 `href` 的 `a` 不吞点击、交互元素点击仍冒泡、任何点击都不再选中整块、`vbscript:` 不剔除、前导空格不 `trim`、`iframe` 不剔除、无 `DOMParser` 不退化为文本、横幅点击不挪光标、横幅非主键也触发、折叠后无条件点亮虚拟行、不读本事务 effect、虚拟行不再拥有文末光标。

### 改动前后必跑

- `pnpm --filter @md-editor/editor test`
- `pnpm --filter @md-editor/desktop exec playwright test e2e/codemirror-m4-html-mdx.spec.ts e2e/codemirror-virtual-trailing-line.spec.ts`

---

## 范围外（未做）

- HTML 块内的结构化编辑（预览只读，编辑走源码态）；
- `<details>` / `<summary>` 的交互：白名单不含这两个标签，清洗时标签被剥掉，只剩文字（实测 `<details><summary>标题</summary>正文内容</details>` 预览为 `标题正文内容`，标题与正文连在一起，不可折叠）。要支持需扩白名单并重新评估安全面；
- 桌面专属行为（真实 Tauri 窗口里的点击与 IME）E2E 覆盖不到，只能手测。
