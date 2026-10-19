# 整行块级替换 Inclusivity 与符号型块间距规范（含 Thematic Break）

> 状态：CodeMirror 6 当前生效契约。已在 Chromium/WebKit/desktop 矩阵与单元测试中完整验证通过。

## 用途

记录所见即所得（WYSIWYG）模式下，**所有整行块级替换装饰**（`Decoration.replace({ block: true })`）的构建机制、CodeMirror 6 Inclusivity 边界语义、以及防御“上方合成幽灵空行”与“向下吞并紧随换行”的核心契约；并定义**符号型块默认间距规则**（如水平分割线 Thematic Break）。

触发阅读的改动范围（任一命中即必须先读本规范）：

- `packages/renderer-codemirror/src/wysiwyg/blocks/block-replacement.ts`（契约与规则的**唯一实现来源**）；
- 任何整行块级投影：`table-projection.ts`（表格）、`html-projection.ts`（HTML 块）、`mdx-projection.ts`（MDX 组件块）、`default-visualization.ts`（setext 标题 / 引用式定义 / 脚注定义等兜底原子块）、`link-projection.ts`（分割线）；
- 任何在 WYSIWYG 中新增“整行块级 widget”或调整其垂直间距的改动。

---

## 缺陷背景与现象 (Symptom & Background)

同一根因已暴露两次，后一次（表格族）是本规范的直接触发原因。

### 第一次：分割线（已修复）

在 WYSIWYG 渲染下，当用户文档包含如下形式的 Markdown 分割线：

```markdown


---


```

在旧实现中，用户遇到了两个交互与视觉异常：
1. **视觉空行多出一行**：源码中 `---` 上方只有 2 个真实换行（空行），但在所见即所得界面中，视觉上渲染出了 3 个空行；
2. **光标垂直漂移与上浮错位**：使用方向键（`ArrowDown`）垂直移动光标进入 `---` 行时，光标的闪烁视觉位置飘在 `---` 的上方那一行中；但一旦切换到源码模式，光标实际处于第 3 行（`---` 所在行），暴露出视觉与底层文档 offset 的严重割裂。

### 第二次：表格 / HTML 块 / MDX 块 / 兜底原子块（本轮修复）

用户报告：源码

```markdown
## 1. 竞品概况

| 维度 | VMark | Inkpoint（本项目） |
```

在 WYSIWYG 下标题与表格之间渲染出 **2 个空行**（源码只有 1 个）。根因完全相同：这四类投影仍然写着 `inclusive: false`。实测对照（Playwright 枚举 `.cm-content > *`）：

| 块类型 | 修复前 | 修复后 |
| --- | --- | --- |
| 表格 / HTML 块 / MDX 块（源码 1 空行） | **2 个空行** | 1 个空行 |
| 分割线（源码 1 空行） | 1 个空行（已修复） | 1 个空行 |
| 段落 / 引用 / 列表 / 代码块 | 1 个空行 | 1 个空行 |
| 任意块紧贴标题（源码 0 空行） | 0 个空行 | 0 个空行 |

---

## 第一性原理根因分析 (First-Principles Analysis)

### 1. CodeMirror 6 块级替换构建机制

在 `@codemirror/view` 源码中，CodeMirror 的视图构建器（`RangeSet.spans`）通过遍历所有活跃的 Decoration，并在 `PointDecoration` 上根据 `block: true` 处理行切分与 Widget 挂载：

```javascript
// @codemirror/view 构建器核心逻辑片段
if (deco.block) {
    if (deco.startSide > 0)
        b.addLineStartIfNotCovered(pendingLineAttrs);
    b.addBlockWidget(tile);
}
```

其中 `startSide` 与 `endSide` 由 `getInclusive(spec, block)` 决定：
- 当 `block: true` 时，若未显式指定 `inclusive`，CM6 默认 `inclusive` 为 `true`；
- 若设置 `inclusive: false`（等价于 `inclusiveStart: false` 且 `inclusiveEnd: false`），则：
  - `startSide = 500000000 - 1 > 0`；
  - `endSide = -600000000 + 1 < 0`。

### 2. 幽灵空行的产生（起点 Inclusivity 破裂）

- 旧实现将 `ThematicBreakWidget` 替换装饰器显式标记为了 `inclusive: false`；
- 由于 `deco.startSide > 0`，CodeMirror 判定：**该替换装饰器的起点并没有覆盖行首起点位置**（`record.fullRange.from`）；
- 构建器因此在执行 `addBlockWidget` 之前，强行调用了 `b.addLineStartIfNotCovered()`，**在分割线组件上方强行合成了一个幽灵 `<div class="cm-line">`**；
- 当光标移动到 `record.fullRange.from`（第 3 行首个字符 `-`）时，CodeMirror 自然而然地把光标渲染进了这个幽灵空行内，导致视觉上比源码多出了一行空行，光标也上浮错位到了分割线上方。

### 3. 下方换行被吞并的陷阱（终点 Inclusivity 破裂）

- 若直接移除 `inclusive: false`，则 CM6 对 `block: true` 默认应用 `inclusive: true`（即 `inclusiveStart: true` 且 `inclusiveEnd: true`）；
- 分割线替换范围 `replacementTo` 包含了整行之后的换行符（`\n`）；
- 由于 `inclusiveEnd: true`，Widget 获得了 `TileFlag.IncEnd` 标志；
- 当构建器前进到 `replacementTo` 之后的紧随换行时，`b.blockPosCovered()` 返回 `true`，导致构建器认为紧随其后的换行已被当前 Widget 覆盖，**直接吞并了分割线下方的空行**（下方空行由 2 行缩减为 1 行，光标下移步数也随之错乱）。

---

## 核心不变量与设计契约 (Core Invariants)

1. **单一实现来源**：所有整行块级替换装饰必须经 `packages/renderer-codemirror/src/wysiwyg/blocks/block-replacement.ts` 的 `buildWholeLineBlockReplacement()` 构建，禁止在 projection 文件里手写 `Decoration.replace` 的边界参数；`trailingLineBreakEnd()` 亦只有该模块一份实现。
2. **不对称 Inclusivity 契约**：
   对于覆盖整行（从行首到行末 `\n`）的块级替换装饰器（如 `ThematicBreakWidget`、`TableGridWidget`、`HtmlBlockWidget`、`MdxComponentWidget`），**必须精准采用不对称 Inclusivity 配置**：
   ```typescript
   Decoration.replace({
     widget,
     block: true,
     inclusiveStart: true,  // 消除起点未覆盖判定，阻止上方合成幽灵空行
     inclusiveEnd: false,   // 阻止向后吞并紧随其后的换行，确保下方空行精确
     wysiwygRecordId: record.id,
     wysiwygRole: role,
   }).range(record.fullRange.from, replacementTo);
   ```
   等价实现即 `buildWholeLineBlockReplacement({ record, state, widget, role, includeTrailingLineBreak })`。
3. **起点必须在行首**：装饰器起点必须等于其所在行的行首（`state.doc.lineAt(from).from === from`），否则 CM6 仍可能合成幽灵空行。新增整行块级 widget 时必须在单测中显式断言这一点。
4. **严禁对覆盖整行的块级组件设置 `inclusive: false`**：
   严禁在未经过边界验证的情况下对 `block: true` 装饰器简单设置 `inclusive: false`，防止 CodeMirror 生成幽灵行。
5. **行内替换不受本契约约束**：`default-visualization.ts` 中 `block: false` 的行内原子（autolink / 引用式链接 / 引用式图片 / 脚注引用）必须保持 `inclusive: false`，因为它们是行内替换，取消 inclusive 会改变游标 reveal 与选区语义。`buildDefaultAtomLayoutDecorations()` 因此必须按 `value.block` 分支。
6. **空行保真优先于视觉节奏**：WYSIWYG 的空行数量必须与源码 1:1（源码 N 个空行 ⇒ 视觉 N 个空行；0 个 ⇒ 相邻）。不允许用伪造空行来制造间距。
7. **整块原子选中态键入必须收敛为光标**：`inclusiveStart: true` 会让 CM6 把 widget 标记为 `TileFlag.IncStart`，`resolveBlock` 因此把 DOM 选区锚点放进 **widget 内部**；当键入字符替换整块时，浏览器选区会顺着被替换掉的 widget DOM 回读成**覆盖刚键入文本的范围**，下一次键入就会把上一字符删掉（现象：丢首字符，例如 `replacement` → `eplacement`）。因此整行块级原子（表格 / HTML / MDX / 块级兜底原子）的键入必须由 `blockAtomTypingInputHandler`（`atom-selection.ts`）显式派发事务（changes + 折叠光标），不得依赖 DOM 选区回读。行内原子、普通文本选区、IME 组字保持原生路径。

### 已登记豁免：Mermaid 块（2026-10）

`MermaidBlockWidget`（`packages/syntax-plugins/src/mermaid/mermaid-projection.ts`）目前仍**手写** `Decoration.replace({ …, inclusive: false, block: true })`，未经 `buildWholeLineBlockReplacement()`——即与不变量 #1/#4 存在漂移。

**本仓库显式接受该现状**，理由与约束：

- 改走统一实现会移动替换 range，并打破既有装饰几何断言（`packages/syntax-plugins/tests/mermaid.test.ts` 中 `inactiveDecos[0].from/to === record.fullRange.to`），属独立风险面，需另开任务；
- 因此 **Mermaid 块暂不受 #2（不对称 Inclusivity）约束**，也不得借本豁免去放宽其它块级 widget；
- **已知回归缺口（2026-10 实测确认，不再是推测）**：既有块级空行保真 e2e 的夹具只覆盖表格 / HTML / MDX / 分割线，**未覆盖 mermaid**；而在启用 mermaid 插件的完整 app harness 中实测：
  - 源码 1 个空行 ⇒ 视觉 **2** 个空行（**多一个幽灵行**）；
  - 源码 **0** 个空行 ⇒ 视觉 **1** 个空行（同样多一个）——即 mermaid 块目前**恒定多渲染 1 个幽灵行**。

  这正是手写 `inclusive:false` 未采用不对称 Inclusivity 的后果，已由 `codemirror-mermaid-viewer.spec.ts` 的「块间空行保真（已登记偏差）」用例**钉死当前行为**（非假绿：后续改走统一实现时该用例会变红，需同步改断言并删除本偏差声明）。修复方向：让 mermaid 改走 `buildWholeLineBlockReplacement()`（会移动 range 并需同步调整 `packages/syntax-plugins/tests/mermaid.test.ts` 的装饰几何断言），属独立任务。

### 符号型块（symbol block）默认间距规则

**定义**：一个整行块级 widget 属于符号型块，当且仅当同时满足：

1. 其替换范围覆盖整行；（即本规范 Inclusivity 契约的作用域）
2. 渲染物**不含用户可读文本内容**，仅为结构符号/装饰（如分割线；未来的分隔型 HTML 块等同类）；
3. 其视觉厚度由系统决定，用户无法用源码空行以外的粒度微调。

**规则**：

- 符号型块的“呼吸感”由**展示层统一提供**，而不是伪造空行：renderer 侧通过 `applyBlockCategory(dom, "symbol")` 声明类别（输出 `data-md-block-category="symbol"`），`blockReplacementTheme` 为该类别统一声明垂直间距：
  ```css
  [data-md-block-category="symbol"] {
    box-sizing: content-box;
    padding-top: var(--theme-block-symbol-gap, 0.5rem);
    padding-bottom: var(--theme-block-symbol-gap, 0.5rem);
  }
  ```

- 当前成员：**分割线**（`ThematicBreakWidget`）。新增同类块只需调用 `applyBlockCategory(dom, "symbol")` 即自动获得该间距。
- **严禁**在 editor-ui CSS 里对某个符号型 widget 单独写间距（例如曾经的 `.cm-md-thematic-break-widget { margin: 0 }` 会覆盖统一规则，属逐 widget 硬编码），也**严禁**把本规则改回 `margin`。
- 间距只允许加**垂直方向**，不得改变空行数量、源码或光标步数。
- 宿主（editor-ui / 移动端等）可通过定义 `--theme-block-symbol-gap` 覆盖数值；未定义时回落到 `0.5rem`（DESIGN.md 4px 基线网格）。

> ⚠ **为什么必须是 `padding` 而不是 `margin`（硬约束）**：CM6 的点击→位置映射依赖高度图，而高度图只量
> border-box、**不含 margin** ⇒ 用 margin 提供的间距会成为累计误差，累计超过一个行高时用户
> **点击某行、光标却落到下一行**。完整机制、实测数据、已排除假设、诊断方法与残项登记见
> **[CM6 高度图与点击落点保真规范](./codemirror_height_map_and_click_fidelity_spec.md)**（本事实的唯一事实源）。
> 回归护栏：`apps/desktop/e2e/codemirror-click-caret-fidelity.spec.ts`。

**已接受的不一致（不要当 bug 修）**：符号型块自带的间距与相邻源码空行是**叠加**关系（不会 margin collapse），因此符号型块在“源码 1 个空行”时看起来会比普通段落之间的 1 个空行略宽。这是用户明确接受的代价：细符号块紧贴正文时观感过挤，而用户无法用“半个空行”微调它。

---

## 验证与回归防护

1. **契约单元测试（装饰参数层）**：
   - `packages/renderer-codemirror/tests/wysiwyg/block-replacement.test.ts`：直接断言统一构造器的 `block` / `inclusiveStart` / `inclusiveEnd`、尾换行覆盖开关、起点在行首、类别属性写入。
   - `tests/wysiwyg/link-projection.test.ts` / `table-projection.test.ts` / `html-projection.test.ts` / `mdx-projection.test.ts` / `default-visualization.test.ts`：逐投影断言接线到本契约（`block === true`、`inclusiveStart === true`、`inclusiveEnd === false`、`lineAt(from).from === from`），并断言行内原子仍为 `block: false` + `inclusive: false`。
2. **端到端 E2E 测试**：
   - `apps/desktop/e2e/thematic-break-rendering.spec.ts`：
     - 测试 1：`\n\n---\n\n` 渲染时，`.cm-content` 子节点中 `---` 上方有且仅有 2 个 `.cm-line`，下方有且仅有 2 个 `.cm-line`；
     - 测试 2：方向键 `ArrowDown` / `ArrowUp` 移入与移出分割线时光标不高浮，原子高亮准确；
     - 测试 3：WYSIWYG 与 Source 模式切换时光标行完全一致；
     - 测试 4：原子删除与 Undo 完整恢复。
   - `apps/desktop/e2e/wysiwyg-block-blank-line-fidelity.spec.ts`：
     - 表格 / HTML 块 / MDX 块 / 分割线 × 空行档位 `{0, 1}`：断言标题与 widget 之间的空 `.cm-line` 数量等于源码空行数量，并以段落作对照；
     - 方向键进入整块原子时 `selectionAnchor/Head` 等于块源码范围，且光标不得绘制在 widget 顶边之上；
     - 表格 / HTML / MDX 整块原子选中态键入 `ab` ⇒ 源码被替换为 `ab`（锁死“丢首字符”回归）；
     - 行内 JSX 不丢内容且不产生额外空行；
     - 符号型块的 `data-md-block-category` 为 `symbol`，计算后 `margin` 为 0、上下 `padding` 均等于 `--theme-block-symbol-gap`（回落 0.5rem），且 border-box 高度 = 符号本体 1.85rem + 2×gap（视觉足迹不变）。
   - `apps/desktop/e2e/codemirror-click-caret-fidelity.spec.ts`（**点击落点保真**，本轮新增）：
     - 块级行不得用垂直 margin 提供间距（带已登记残项基线）；
     - 滚动后点击段落，`selectionHead` 必须落在被点击的那一行，且 `.cm-cursor` 必须绘制在该行盒内。
3. **回归面（改动后必须全量通过）**：`codemirror-m3-table.spec.ts`、`codemirror-m4-html-mdx.spec.ts`、`codemirror-m4-mdx.spec.ts`、`thematic-break-rendering.spec.ts`、`ux-fixes-verification.spec.ts` 以及 `pnpm lint` / `pnpm test` / `pnpm typecheck`。
