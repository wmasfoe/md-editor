# CM6 高度图与点击落点保真规范

## 用途

规定 CodeMirror 6 中「**鼠标点击位置 → 文档位置**」映射所依赖的**高度图契约**，以及给块级行/块级 widget
提供垂直空间、改变行高或块盒模型时必须遵守的不可变量。

**改这些地方之前先读本规范**：

- 给块级行或块级 widget 增加/调整**垂直间距**（上下留白、呼吸感、分隔感）；
- 改变**行高**、块级 widget 的 `height` / `min-height` / `box-sizing` / `padding`；
- **新增整行块级 widget**（表格、HTML、MDX、代码块、图片、mermaid 等）；
- 修复「点击错位 / 光标落在别处 / 选区起点不对」类问题；
- 在 CI 之外怀疑「滚动后行为异常」。

> 一句话结论：**块级行的垂直空间必须用 `padding` 交付，禁止用 `margin`。**
> 违反它不会立刻报错，但用户在滚动后点击时会稳定落到**隔壁行**。

---

## 缺陷背景与现象 (Symptom & Background)

用户报告（真实文档 142 行）：在段落 `在 Agent 工作流里，不同的 Skill 就像剧组里不同的专业部门…`
上点击「Agent」的字母 A，**光标却出现在下一行的行首**，视觉与文档 offset 严重割裂。

实测特征（Playwright + 真实 Chromium）：

| 观测 | 结果 |
| --- | --- |
| 滚动后点击目标段落 | `selectionHead` 落到**下一行**（699 → 746，恰好一行），`.cm-cursor` 绘制在点击点下方约一行 |
| 未滚动时点击同一段落 | 正确 |
| 把 mermaid 块整块删掉 / 换成表格 / 换成等行数纯文本 / 再删掉分割线 | **仍然 +1** |
| 在 `main`（`7cf5b0c`）上跑同一测试 | **同样 +1** |
| 点击前后段落 `getBoundingClientRect().y` 与 `scrollTop` | **完全不变**（排除布局位移） |

结论：与 mermaid、与任何特定块类型无关，是**通用机制缺陷**，且是既有缺陷（非某次特性分支引入）。

---

## 第一性原理根因分析 (First-Principles Analysis)

### 1. 点击 → 位置的映射完全建立在高度图上

`@codemirror/view@6.43.1` `dist/index.js:3768` `function posAtCoords`：

```js
let content = view.contentDOM.getBoundingClientRect();
let docTop = content.top + view.viewState.paddingTop;
let yOffset = y - docTop;
...
block = view.elementAtHeight(yOffset);      // ← y → 行/块：完全来自高度图
...
if (block.type != BlockType.Text) return ...;
let line = view.docView.lineAt(block.from, 2);
return new InlineCoordsScan(view, x, y, ...).scanTile(line, block.from);
```

即：先用高度图把**物理 y** 换成**行号**，再在该行内用真实 x 求列偏移。
**高度图错多少，光标就错多少；错到一个行高，就落到隔壁行。**

### 2. 高度图只量 border-box，不量 margin

高度图的数据来源有二：

- **视口内的行/块**：实测 `getBoundingClientRect().height`（`measureVisibleLineHeights`）；
- **视口外的整段（gap）**：估算（见下）。

`getBoundingClientRect().height` **不包含 margin**。因此**任何用 margin 提供的垂直空间都不会进入高度图**。

### 3. 视口外是估算，误差按行累计

`dist/index.js:5329`：

```js
heightForGap(from, to) {
  let lines = this.doc.lineAt(to).number - this.doc.lineAt(from).number + 1;
  if (this.lineWrapping)
    lines += Math.max(0, Math.ceil(((to - from) - (lines * this.lineLength * 0.5)) / this.lineLength));
  return this.lineHeight * lines;
}
```

这解释了为什么缺陷只在「点击行**之上有未测量区域**」时显现（滚动后 / 首屏之外的区块）。

### 4. 误差如何变成「偏一行」

本次缺陷的完整链条：

1. 符号型块（`---`）的间距曾由核心层以 **margin** 交付（`block-replacement.ts`，
   `marginTop/Bottom = var(--theme-block-symbol-gap, 0.5rem)`）⇒ 每个 `---` **8px + 8px = 16px**；
2. 用户文档中点击点上方有 **2 个 `---`** ⇒ 高度图**漏算 32px**；
3. 行高为 **28px**，`32px > 28px` ⇒ 物理 y 在 CM6 坐标系里"多走"一整行 ⇒ 选中下一行。

实测印证：**逐行网格扫描**显示「分割线之后整体 +1 行、分割线之前完全对齐」；
**行盒间隙测量**显示只有 `---` 行存在 `gap = 8px`（`margin: 8px/8px`），其余行 `gap = 0`；
目标行上方累计空隙恰为 **32px**。

### 5. 已排除的假设（负结果同样要记录）

| 假设 | 否证方式 |
| --- | --- |
| mermaid 整行块级替换的幽灵行（`thematic_break_and_block_inclusivity_spec.md` 的同类症状） | 块上方/下方各 5 组邻接配置偏差均为 0；把 mermaid 整块删掉仍 +1 |
| 块工具栏负 margin（历史缺陷 `2ccc80e`） | 本次 mermaid 工具栏为 `position: absolute`，无负 margin；无 mermaid 时仍复现 |
| mermaid SVG 异步到达导致高度图过期 | `mermaid-projection.ts:32` 已调 `requestMeasure`；「加载中点击」与「渲染后点击」结果完全相同 |
| 中文软换行 / 标题行高偏大 | 去掉全部标题前缀、把长行截短后仍 +1（可见行高全部为 28px） |

> 注：`measureTextSize()`（`dist/index.js:3324`）的 `charWidth` **只采 ASCII**（`/[^ -~]/` 直接放弃，
> 兜底样本 `"abc def ghi jkl mno pqr stu"`），`lineLength = contentWidth / charWidth`（`dist/index.js:6344`）。
> 这意味着**中文长行的换行行数会被低估**，是高度图误差的另一个理论来源；但本次缺陷**未被其触发**
> （上表最后一行）。若日后出现「长文档滚动条明显偏短」或「偏移量随距离累积」的现象，应优先怀疑它。

---

## 核心不变量与设计契约 (Core Invariants)

### I1. 块级行的垂直空间必须用 `padding`，禁止 `margin`

```ts
// ✅ 正确：padding 计入 border-box ⇒ 进入高度图
[`[${WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE}="symbol"]`]: {
  boxSizing: "content-box",
  paddingTop: `var(${BLOCK_SYMBOL_GAP_VARIABLE}, 0.5rem)`,
  paddingBottom: `var(${BLOCK_SYMBOL_GAP_VARIABLE}, 0.5rem)`,
}

// ❌ 禁止：margin 不计入 border-box ⇒ 高度图漏算 ⇒ 点击偏行
{ marginTop: "...", marginBottom: "..." }
```

**配套要求**：若该 widget 自带固定 `height` 且为 `border-box`，必须同时改为 `content-box`，
否则 padding 会被那层高度"吃掉"（间距消失，且高度图依旧漏算）。

**实施位置**：间距规则收敛在 renderer 核心层（`packages/renderer-codemirror/src/wysiwyg/blocks/block-replacement.ts`），
宿主只提供设计值 token（`--theme-block-symbol-gap`）。**禁止**逐 widget 手写间距。

### I2. 禁止用会影响视觉位置的"测量盲区"手段

负 margin、`transform: translateY(...)`、`position: relative; top` 等都会让 DOM 视觉位置与
CM6 度量不一致。历史事故 `2ccc80e`（块工具栏 `marginInlineStart: -5.5rem` 导致点击落块首行错到下一行）
已证明该类手段会被 CM6 的坐标测量放大成用户可见缺陷。

### I3. 异步改变块高必须显式请求重测

块内高度在**首次测量之后**才变化（图片解码、SVG 注入、字体加载、异步组件）时，必须
`view.requestMeasure({ read: (v) => { v.viewState.mustMeasureContent = true } })`。
先例：`packages/syntax-plugins/src/mermaid/mermaid-projection.ts:32` `scheduleHeightMeasure`。

### I4. 行内 vs 块级：先判定它到底是不是「一行」

- `Decoration.replace({ block: true })` ⇒ 该 widget **自身就是行**（`.cm-content` 的直接子节点）⇒ 适用 I1；
- `Decoration.replace({ ... })`（无 `block: true`）+ `display: inline-*` ⇒ **行内盒**，
  其垂直 margin 属于行盒高度计算的一部分，CM6 量 `.cm-line` 时已包含 ⇒ **不受本缺陷影响**
  （先例：`.cm-md-image-widget` 为 `display: inline-flex`）。

### I5. 测试必须断言用户可见行为，不得只断言实现细节

反面案例：`wysiwyg-block-blank-line-fidelity.spec.ts` 曾断言
「计算后的垂直 **margin** 等于 `--theme-block-symbol-gap`」——
这条断言把**坏机制**钉成了契约，导致缺陷长期无法被发现（改机制时反而被测试拦下）。

正确做法：断言**用户可见结果**（点击落点 / 光标是否在被点击的行盒内 / 行盒总高），
实现细节（margin 还是 padding）最多作为**辅助**断言。

---

## 诊断方法（可复现）

怀疑此类问题时，按下面顺序取证，**不要靠读代码猜**：

1. **网格扫描法**：在可视区按固定 y 步长（如每 28px）点击，同时记录
   ① `document.elementFromPoint` 命中的 `.cm-line` 文本 ② `selectionHead` 反推的模型行；
   两者开始不一致的 y 即为**发散点**，不一致量即**偏移行数**。
   （注意：目录/链接行会拦截点击，采样点应取行盒右侧空白，避免命中链接文本。）
2. **行盒间隙测量法**：遍历 `.cm-content > *`，计算相邻行 `next.top - prev.bottom` 与
   `getComputedStyle().marginTop/Bottom`。**非零 gap 就是高度图的漏算量**；累计值超过行高即必然偏行。
3. **对照法**：同一文档分别在不滚动/滚动下点击同一行，判断缺陷是否依赖「视口外未测量区域」。

---

## 验证与回归防护

- `apps/desktop/e2e/codemirror-click-caret-fidelity.spec.ts`（**本规范的主护栏**）
  - 用例 1：块级行不得用垂直 margin 提供间距（带显式登记的残项基线，且残项数值被钉死不得放大）；
  - 用例 2：滚动后点击段落 ⇒ `selectionHead` 必须落在被点击的那一行，且 `.cm-cursor` 必须绘制在该行盒内。
- `apps/desktop/e2e/wysiwyg-block-blank-line-fidelity.spec.ts`
  - 符号型块：`data-md-block-category="symbol"`、`margin` 为 0、上下 `padding` 等于 `--theme-block-symbol-gap`、
    border-box 高度 = 符号本体 + 2×gap（视觉足迹不变）。
- 回归面：任何调整块级间距/行高/盒模型的改动，必须跑
  `pnpm lint` / `pnpm test` / `pnpm typecheck` + 整套 `pnpm --filter @md-editor/desktop test:browser`。

---

## 已知残项（显式登记，勿静默放过）

| 残项 | 漏算量 | 何时会复现 | 修复方向 |
| --- | --- | --- | --- |
| `.cm-md-mdx-widget` 仍用 `margin: 0.25rem 0`（`wysiwyg/projections/mdx-projection.ts`） | 每块 **8px** | 点击点上方有 **4 个以上** MDX 块（≥32px > 行高 28px） | 卡片自带 `border` + `background`，直接改 padding 会让间距被边框/背景包进去 ⇒ 需「外层行容器承载 padding + 内层卡片保留边框背景」结构改造 |

护栏已把该残项的数值钉死（`codemirror-click-caret-fidelity.spec.ts` 的 `KNOWN_RESIDUAL`），
任何放大（如 4px → 12px）或新增同类违规都会让测试失败。

## 变更记录

- 2026-10：从「符号型块间距用 margin」改为 padding，修复用户报告的点击偏行；
  新增本规范与 `codemirror-click-caret-fidelity.spec.ts` 护栏。详见
  `.omx/investigations/click-caret-offset-after-scroll.md`。
