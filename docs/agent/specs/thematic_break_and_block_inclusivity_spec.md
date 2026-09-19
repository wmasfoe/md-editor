# Thematic Break 渲染与 CM6 块级替换 Inclusivity 规范

> 状态：CodeMirror 6 当前生效契约。已在 Chromium/WebKit/desktop 矩阵与单元测试中完整验证通过。

## 用途

记录所见即所得（WYSIWYG）渲染模式下，Markdown 水平分割线（Thematic Break，如 `---`、`***`、`___`）的块级替换装饰器（`Decoration.replace({ block: true })`）构建机制、CodeMirror 6 Inclusivity 边界语义、以及防御“上方合成幽灵空行”与“向下吞并紧随换行”的核心契约。修改 `packages/renderer-codemirror/src/wysiwyg/link-projection.ts` 或涉及整行块级投影替换前，必须先读本规范。

---

## 缺陷背景与现象 (Symptom & Background)

在 WYSIWYG 渲染下，当用户文档包含如下形式的 Markdown 分割线：

```markdown


---


```

在旧实现中，用户遇到了两个交互与视觉异常：
1. **视觉空行多出一行**：源码中 `---` 上方只有 2 个真实换行（空行），但在所见即所得界面中，视觉上渲染出了 3 个空行；
2. **光标垂直漂移与上浮错位**：使用方向键（`ArrowDown`）垂直移动光标进入 `---` 行时，光标的闪烁视觉位置飘在 `---` 的上方那一行中；但一旦切换到源码模式，光标实际处于第 3 行（`---` 所在行），暴露出视觉与底层文档 offset 的严重割裂。

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

1. **不对称 Inclusivity 契约**：
   对于覆盖整行（从行首到行末 `\n`）的块级替换装饰器（如 `ThematicBreakWidget`），**必须精准采用不对称 Inclusivity 配置**：
   ```typescript
   Decoration.replace({
     widget: new ThematicBreakWidget({ ... }),
     block: true,
     inclusiveStart: true,  // 消除起点未覆盖判定，阻止上方合成幽灵空行
     inclusiveEnd: false,   // 阻止向后吞并紧随其后的换行，确保下方空行精确
     wysiwygRecordId: record.id,
     wysiwygRole: "thematic-break-widget",
   }).range(record.fullRange.from, replacementTo);
   ```
2. **严禁对覆盖整行的块级组件设置 `inclusive: false`**：
   严禁在未经过边界验证的情况下对 `block: true` 装饰器简单设置 `inclusive: false`，防止 CodeMirror 生成幽灵行。
3. **架构职责与隔离边界**：
   - 本规范约束严格收敛于 `packages/renderer-codemirror/src/wysiwyg/link-projection.ts` 中的 `ThematicBreakWidget`；
   - 严禁随意修改其他块级组件（如 Table、HTML、MDX），各个复杂块级组件拥有独立的生命周期、网格选区或只读保护逻辑，必须独立验证。

---

## 验证与回归防护

1. **自动化单元测试**：
   - `packages/renderer-codemirror/tests/wysiwyg/link-projection.test.ts`：显式断言 `decorationSpec.block === true`、`decorationSpec.inclusiveStart === true`、`decorationSpec.inclusiveEnd === false`。
2. **端到端 E2E 测试**：
   - `apps/desktop/e2e/thematic-break-rendering.spec.ts`：
     - 测试 1：`\n\n---\n\n` 渲染时，`.cm-content` 子节点中 `---` 上方有且仅有 2 个 `.cm-line`，下方有且仅有 2 个 `.cm-line`；
     - 测试 2：方向键 `ArrowDown` / `ArrowUp` 移入与移出分割线时光标不高浮，原子高亮准确；
     - 测试 3：WYSIWYG 与 Source 模式切换时光标行完全一致；
     - 测试 4：原子删除与 Undo 完整恢复。
