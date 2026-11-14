# CM6 块级 widget 的文末落脚行规范

> 状态：CodeMirror 6 当前生效契约（`@codemirror/view` 6.43.15 实测）。升级 `@codemirror/view` 后必须重跑本规范「验证」一节的探针。

## 用途

记录 CodeMirror 6 视图构建器如何处理「文档末尾的块级 widget」：什么时候它会在块下方**自己补一个空的 `.cm-line`**、这一行为什么是文末唯一的文本落脚点，以及为什么应当复用它而不是自己再造一行。

这是一篇**机理规范**，不描述具体功能。功能规范见：

- [WYSIWYG 文末虚拟空行规范](./wysiwyg_virtual_trailing_line_spec.md)（本规范的直接使用者）；
- [整行块级替换 Inclusivity 规范](./thematic_break_and_block_inclusivity_spec.md)（同一套 `inclusiveStart` / `inclusiveEnd` 语义，针对「块上方」的幽灵空行；本规范针对「块下方」）。

触发阅读的改动范围（任一命中即必须先读本规范）：

- 在文档末尾（`doc.length`）放置任何 `block: true` 的 widget 或 replace 装饰；
- 新增整行块级 widget，且它可能出现在文档最后；
- 排查「文末块下面多了一个空行 / 少了一个空行 / 光标落到块里」；
- 升级 `@codemirror/view`。

---

## 一、CM6 视图构建器的补行机制

`@codemirror/view` 在 `dist/index.js` 的构建循环里，对「没有被块 widget 覆盖的位置」调用 `addLineStartIfNotCovered`，在那里补一个空的 `.cm-line`。有两处触发：

1. **放置块 widget 之前**：遇到 `deco.block` 且 `deco.startSide > 0` 的装饰，先补一行再放 widget。
2. **构建结束时**：整个文档遍历完，若末尾位置仍未被覆盖，补一行。

「是否已被覆盖」由 `blockPosCovered()` 判定：

```js
blockPosCovered() {
  let last = this.lastBlock;
  return last != null && !last.breakAfter &&
    (!last.isWidget() || (last.flags & (TileFlag.After | TileFlag.IncEnd)) > 0);
}
```

即：最后一个块若是 widget，只有带 `After` 或 `IncEnd` 标志才算覆盖了它之后的位置。

`TileFlag` 由 `widgetFlags(deco)` 给出：

- replace 装饰：`startSide < 0` → `IncStart`；`endSide > 0` → `IncEnd`；
- 普通 widget：`startSide > 0` → `After`，否则 `Before`；
- `deco.block` → 额外带 `Block`。

`startSide` / `endSide` 来自 `Decoration.replace` 的 `inclusiveStart` / `inclusiveEnd`（`getInclusive`）：`inclusiveStart: true` 得到 `startSide < 0`，`inclusiveEnd: true` 得到 `endSide > 0`。

### 推论：整行块级替换下面总会有补出来的一行

仓库里所有整行块级替换（表格 / HTML / 分割线 / MDX 等）都经 `buildWholeLineBlockReplacement()` 构建，固定为 `inclusiveStart: true, inclusiveEnd: false`（见 Inclusivity 规范）。`inclusiveEnd: false` 意味着没有 `IncEnd`，`blockPosCovered()` 为假，构建结束时 CM6 在块下面补一行。

**实测**：去掉虚拟行扩展后，表格结尾的文档（无论是否有尾随换行）块下方都是一个空 `.cm-line`；表格上方的幽灵空行则已由 `inclusiveStart: true` 消除。

---

## 二、补出来的那一行：是唯一的文本落脚点，但自己不会把键入写到块外

这一行是 CM6 合成的占位，对应文档里**不存在的行**，但它是一个真正的 `.cm-line` 文本节点。这带来两个同时成立的事实：

**事实 1：它是文末唯一能承载浏览器光标的地方。** 浏览器的光标只能落在可编辑的文本节点里。CM6 把 `doc.length` 的光标写进 DOM 选区时（`docView.updateSelection` → `inlineDOMNearPos`），只在**文本行 tile** 里找位置；没有就退回最近的上一个文本行。

**事实 2：光标停在它上面直接键入，字会被解析进块。** 浏览器把字符插进这一行，CM6 读回来是「块的最后一行末尾」：

| 文档 | 键入 `x` 后 | 结果 |
| --- | --- | --- |
| `…\| 1 \| 2 \|`（无尾随换行） | `…\| 1 \| 2 \|x` | `x` 接在最后一个单元格后 |
| `…\| 1 \| 2 \|\n`（一个尾随换行） | `…\| 1 \| 2 \|\nx` | `x` 成为表格新的一行 |

所以正确的做法是**保留这一行当落脚点，把键入交给物化处理器**：处理器在虚拟行激活时接管 `inputHandler`，按 `doc.length` 插入「前导换行 + 正文」，完全不看浏览器把字放在了哪。光标落点（事实 1）和写入位置（事实 2）由两个机制分别保证。

---

## 三、四种「在文末自己造一行」的做法：全部实测否决

目标：块下方只有一个落脚行，且光标停在 `doc.length` 再键入，字写在块下方。

| 做法 | 块下方的行 | Cmd/Ctrl+End 后键入 | 否决原因 |
| --- | --- | --- | --- |
| 普通块 widget `side: 1` | 空 `.cm-line` → 虚拟行 | 写进合成行（并进块） | 两个空行；`startSide > 0` 触发补行 ① |
| 普通块 widget `side: -1` | 虚拟行 → 空 `.cm-line` | 同上 | 两个空行；无 `IncEnd`，触发补行 ② |
| 零长度 replace，两端 inclusive | 虚拟行 | **写到块的前面** | 吃掉了合成行，文末没有文本行 tile，DOM 选区退回块上方的空行 |
| 零长度 replace，只一端 inclusive | 两行（同前两行） | — | 只阻止了一处补行 |
| 零长度 replace，两端都不 inclusive | — | — | 抛 `RangeError: Invalid range for replacement decoration` |

「两端 inclusive 的零长度 replace」曾被本规范的上一版定为唯一正确写法：它确实只剩一行，但把文末唯一的文本 tile 吃掉了。tile 树实测（表格 + 1 个尾随换行，`doc.length = 41`）：

```
line   [0,5]    标题
line   [6,6]    空行
widget [7,41]   TableGridWidget        IncStart|Block
widget [41,41]  VirtualTrailingLine    IncStart|IncEnd|Block   ← 41 处没有文本行
```

DOM 选区因此落在 `.cm-content` 第 1 个子节点（表格上方的空行），键入写到位置 6。

---

## 四、核心不变量

1. **不要在文末自己再造一行，复用 CM6 合成的那一行。** 用 `Decoration.line` 在 `doc.length` 给它加 class：`Decoration.line` 只加属性、不产生 tile，CM6 照常合成这一行，光标照常落进来。
2. **合成行只在整行块级替换之后才有。** 块的最后一行若是它自己的真实文本行（Frontmatter 的闭合 `---` 且无尾随换行），`doc.length` 不在行首，`Decoration.line` 会落在块自己的行上。这种情况需要单独的占位块 widget（`side: 1`），它前面没有整行替换，不会再补出第二行。光标停在块的最后一行行尾，键入同样由物化处理器接管。
   - 判断依据是**块此刻是否以整行替换呈现**，不是块的类型：HTML 块被光标展开成源码时，渲染的是带行装饰的真实源码行，没有合成行。
3. **判断「这里有没有行」要看 `.cm-content` 的直接子节点，还要看 tile 树，不能看代码注释，也不能看 `doc.lines`。** CM6 会合成文档里不存在的行；反过来，一个看起来存在的块 widget 也可能没有对应的文本 tile。本规范两次出错都是因为只看了其中一面。
4. **光标落点与写入位置分开保证。** 光标落点靠「文末有文本行」；写入位置靠物化处理器（见虚拟空行规范 C 节）。只保证其一都会出错。
5. **升级 `@codemirror/view` 后重跑「验证」一节的探针。**

---

## 五、验证

### 探针（升级 `@codemirror/view` 后重跑）

在 `/?surface=codemirror-editor&mdx=1` 加载 `## 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`，读 `.cm-content` 直接子节点自表格起的序列：

```ts
Array.from(document.querySelectorAll<HTMLElement>(".cm-content > *"))
  .map((e) => e.classList.contains("cm-virtual-trailing-line") ? "虚拟"
    : e.className.includes("table-widget") ? "表格"
    : (e.textContent ?? "") === "" ? "空.cm-line" : "正文");
```

期望：现行实现为 `表格 → 虚拟`（虚拟行就是那一个合成行，带 `cm-virtual-trailing-line` class）；去掉虚拟行扩展为 `表格 → 空.cm-line`。两者的子节点数相同。

再加一步：`Cmd/Ctrl+End` 后键入 `Q`，`Q` 必须在文末，不能在标题后面。

### 回归测试

- 单测 `tests/wysiwyg/virtual-trailing-line.test.ts` 的 "leaves exactly one landing row below a terminal block"：6 种整行替换文末块 + MDX / Frontmatter 4 条，断言块之后只有一个节点且它是虚拟行。
- e2e `VTL-11`：真实浏览器里块下方只有一个落脚行。
- e2e `VTL-12`：5 种文末块 × 4 种到达文末的方式（Cmd/Ctrl+End、Cmd/Ctrl+ArrowDown、程序化设置选区、撤销一次物化），键入必须成为块下方的独立段落。它同时拦住两种旧实现：普通 widget（字并进块）与零长度 replace（字写到块前面）。
- e2e `VTL-14`：光标画在虚拟行内。

### 范围外

- 块**上方**的幽灵空行：见 Inclusivity 规范；
- Mermaid 块：仍是手写 `inclusive: false`，不经 `buildWholeLineBlockReplacement()`，其文末行为未按本规范验证。
