# CM6 块级 widget 的文末落脚行规范

> 状态：CodeMirror 6 当前生效契约（`@codemirror/view` 6.43.1 实测）。升级 `@codemirror/view` 后必须重跑本规范「验证」一节的探针。

## 用途

记录 CodeMirror 6 视图构建器如何处理「文档末尾的块级 widget」：什么时候它会在块下方**自己补一个空的 `.cm-line`**、这个补出来的行为什么不能当落脚点，以及如何在末尾放一个自己的块 widget 而不与它并存。

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

## 二、补出来的那一行不是安全的落脚点

这一行是 CM6 合成的占位，对应文档里**不存在的行**。光标可以停在上面（`selectionHead` 等于 `doc.length`），但解析器看到的是「块的最后一行末尾」，键入的字符会被吞进块。

实测（表格结尾，隐藏虚拟行后点击这一行再键入 `x`）：

| 文档 | 键入 `x` 后 | 结果 |
| --- | --- | --- |
| `…\| 1 \| 2 \|`（无尾随换行） | `…\| 1 \| 2 \|x` | `x` 接在最后一个单元格后 |
| `…\| 1 \| 2 \|\n`（一个尾随换行） | `…\| 1 \| 2 \|\nx` | `x` 成为表格新的一行 |

所以不能「保留这一行、去掉虚拟行」来消除重复。需要用自己的块 widget 取代它，并在物化时补足前导换行（见虚拟空行规范 C 节）。

---

## 三、在文档末尾放块 widget：四种写法的实测

目标：文档末尾放一个自己的占位行，块下面最终只有一个落脚行。

**普通 widget**（`Decoration.widget({ block: true })`）：

| 写法 | 表格结尾时块下方的行序 | 原因 |
| --- | --- | --- |
| `side: 1` | 空 `.cm-line` → 虚拟行 | `startSide > 0`，触发补行 ① |
| `side: -1` | 虚拟行 → 空 `.cm-line` | 不触发 ①，但没有 `IncEnd`，触发补行 ② |

**零长度块级 replace**（`Decoration.replace({ block: true, … }).range(doc.length)`）：

| `inclusiveStart` | `inclusiveEnd` | 表格结尾时块下方的行序 | 原因 |
| --- | --- | --- | --- |
| `true` | `true` | **虚拟行** | `startSide < 0` 不触发 ①；`IncEnd` 使 `blockPosCovered()` 为真，不触发 ② |
| `true` | `false` | 虚拟行 → 空 `.cm-line` | 无 `IncEnd`，触发 ② |
| `false` | `true` | 空 `.cm-line` → 虚拟行 | `startSide > 0`，触发 ① |
| `false` | `false` | **抛 `RangeError: Invalid range for replacement decoration`** | `from === to` 的 replace 至少一端 inclusive |

**唯一只剩一个落脚行的写法是零长度 replace、两端都 inclusive。** 虚拟空行用的就是它。

---

## 四、核心不变量

1. **在 `doc.length` 放自己的块 widget 时，必须是零长度、两端 inclusive 的 `Decoration.replace`**，不得用普通 `Decoration.widget`，不得只设一端。
2. **判断「这里有没有行」要看 `.cm-content` 的直接子节点，不能看代码注释，也不能看 `doc.lines`。** CM6 会合成文档里不存在的行。本规范的起因就是凭注释推断「块下方没有 `.cm-line`」，结果页面上有。
3. **文档自带空行（`\n\n` 结尾）时不要再放占位 widget**：块下方已经是文档自己的空行，落脚行只有它。
4. **不要把 CM6 合成的那一行当落脚点**，也不要依赖它「看起来有一行」来决定是否需要占位。
5. **升级 `@codemirror/view` 后重跑「验证」一节的探针**，四行结果有任何变化都意味着构建器行为变了。

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

期望：现行实现为 `表格 → 虚拟`；去掉虚拟行扩展为 `表格 → 空.cm-line`。

### 回归测试

- 单测 `tests/wysiwyg/virtual-trailing-line.test.ts` 的 "leaves exactly one landing row below a terminal block"：6 种文末块，断言块之后的直接子节点只有 `cm-virtual-trailing-line`。改回普通 widget 时 7 条失败（含装饰形态断言）。
- 单测 "keeps the document's own blank line as the landing row when there is no virtual line"：文档自带空行时没有虚拟行。
- e2e `VTL-11`：真实浏览器里表格 0 / 1 / 2 个尾随换行、分割线 1 个尾随换行，量块下方节点；改回普通 widget 时表格两条收到 2 行而失败。

### 范围外

- 块**上方**的幽灵空行：见 Inclusivity 规范；
- Mermaid 块：仍是手写 `inclusive: false`，不经 `buildWholeLineBlockReplacement()`，其文末行为未按本规范验证。
