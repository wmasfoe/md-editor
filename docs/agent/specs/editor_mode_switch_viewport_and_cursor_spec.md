# 编辑器模式切换视口滚动与光标几何定位规范

> 状态：CodeMirror 6 当前生效契约。已在长文档滚动编辑、双模式双向切换、阅读态视口保持及 E2E 自动化测试矩阵中完整验证通过。

## 用途

记录所见即所得（WYSIWYG）与源码（Source）模式相互切换时，编辑器视口发生剧烈跳动、光标脱离可见视口的根本原因，以及基于**视口相对光标几何补偿（Screen Offset Anchoring）**与**双模式往返无损记忆（Round-trip Memory）**的解决方案。涉及 `packages/renderer-codemirror/src/renderer.ts` 的模式切换派发、滚动位置维护或视口测量时，必须先读本规范。

---

## 缺陷背景与现象 (Symptom & Background)

在包含大标题、图片、引用块、列表或公式的长文档中，当用户向下滚动并编辑位于文章中部的段落时：
1. **WYSIWYG 切换到 Source 视口剧烈跳动**：
   视口瞬间跳跃至文档最底部，用户正在编辑的段落与光标被甩出可视区域（位于视口上方数百至上千像素），用户必须重新向上手动寻觅光标；
2. **Source 切换到 WYSIWYG 光标脱离视口**：
   由于富文本排版垂直高度激增，原先处于可视区域中央的光标经常被挤出视口下方；
3. **往返切换视觉漂移累加**：
   在 WYSIWYG -> Source -> WYSIWYG 往返切换过程中，若仅依赖 CodeMirror 内部的简单估算，每次切换均会产生数像素到数十像素的垂直漂移，导致编辑界面剧烈晃动。

---

## 第一性原理根因分析 (First-Principles Analysis)

### 1. DOM 垂直排版高度在双模式下存在巨大物理落差

- **WYSIWYG 模式**：由于 H1-H6 标题字号加大、行高扩大、图片占位、嵌入组件（Table / Thematic Break / Callout / Widget）的存在，使得前 $N$ 行的累计 DOM 高度远大于纯文本。例如：第 50 行在 WYSIWYG 模式下的绝对 Y 坐标为 `2600px`；
- **Source 模式**：所有内容均为均一字号、行高的单行或折行纯文本，同样第 50 行的绝对 Y 坐标仅约 `1050px`，整个 60 行文档的总高度甚至仅有 `1500px`。

### 2. 绝对 `scrollTop` 同步的数学截断缺陷

旧实现中，模式切换逻辑直接读取旧模式的绝对 `scrollTop` 并强行传递给新模式：
```typescript
// 旧实现的错误逻辑
const scrollTop = this.#view.getScrollTop();
// ... 派发模式切换 ...
this.#view.setScrollTop(scrollTop);
```
- 当用户在 WYSIWYG 模式下滚动到 `scrollTop = 2100px`（第 50 行业务位置在 2600px，距离视口顶部 500px）；
- 切换到 Source 模式时，源码模式容器的总滚动高度最大仅为 `1500px`；
- 浏览器滚动容器（DOM `scrollDOM.scrollTop`）收到 `2100px` 时，会被强行 **Clamp 截断** 到最大可滚动高度（如 `700px`，视口位于文档最底部）；
- 此时用户光标所在的位置（1050px）在当前视口范围（700px ~ 1500px）内虽然存在，但如果文档更短或标题更多，光标被完全甩到视口之外，造成极其严重的视口与光标丢失。

### 3. CodeMirror 6 `scrollSnapshot` 的阶段局限性

虽然 `@codemirror/view` 提供了 `scrollSnapshot()`，但在整套 ViewPlugin、Facet 重新配置（Reconfiguration）的大型生命周期变更中：
- 动态 Height Oracle 需要在真实的 DOM 布局和重排（Paint & Reflow）之后才能获取精准测绘；
- 内部 snapshot 主要以行号和大致估算为基准，无法保障“光标在屏幕视口中的相对物理像素位置保持绝对不动”。

---

## 核心不变量与设计契约 (Core Invariants)

为彻底解决该问题，在 [`packages/renderer-codemirror/src/renderer.ts`](file:///Users/ikun/code/md-editor/packages/renderer-codemirror/src/renderer.ts) 中确立以下四项核心设计契约：

### 1. 视口相对光标几何锚定补偿契约 (Screen Offset Anchoring)

当光标处于用户屏幕视口可见范围内时，**模式切换前后光标在屏幕上的垂直物理距离必须恒定**：

```typescript
// 1. 切换前捕获光标与视口顶部的相对像素差
const initialCoords = this.#view.getCursorCoordinates?.(cursorPos);
const initialViewport = this.#view.getViewportRect?.();
const cursorOffsetPx = initialCoords && initialViewport &&
  initialCoords.top >= initialViewport.top && initialCoords.bottom <= initialViewport.bottom
    ? initialCoords.top - initialViewport.top
    : null;

// 2. 切换后通过 requestMeasure 异步两阶段精确定位
this.#view.requestMeasure?.({
  read: () => {
    if (cursorOffsetPx !== null) {
      const newCoords = this.#view.getCursorCoordinates?.(cursorPos);
      const newViewport = this.#view.getViewportRect?.();
      if (newCoords && newViewport) {
        // 计算新排版下光标相对于视口顶部的偏移
        const currentOffset = newCoords.top - newViewport.top;
        // 计算像素误差 Δ，并精确补偿给 scrollTop
        const delta = currentOffset - cursorOffsetPx;
        return { delta, currentScrollTop: this.#view.getScrollTop() };
      }
    }
    // ...
  },
  write: (measure) => {
    if (measure && Math.abs(measure.delta) > 0.5) {
      this.#view.setScrollTop(measure.currentScrollTop + measure.delta);
    }
  }
});
```

- **不变量**：若切换时光标在视口内，切换完成后光标的屏幕绝对 Y 坐标漂移量必须满足 $|\Delta| \le 1\text{px}$。

### 2. 双模式无损往返记忆契约 (Round-trip Memory)

- 控制器内部维护 `#modeScrollTopsByMode: Map<EditorMode, number>` 与 `#modeCursorPosByMode: Map<EditorMode, number>`；
- 当用户在没有移动光标的情况下往返切换模式（例如 `WYSIWYG -> Source -> WYSIWYG`）：
  - 目标模式直接优先还原此前该模式记录的历史精确 `scrollTop`；
- **不变量**：连续往返切换模式时，原模式的视口滚动位置漂移必须为 0px。

### 3. 阅读态视口保持契约 (Off-screen Cursor Preservation)

- 若切换时光标处于视口外部（用户正在滚屏阅读，光标留在远处的首行或末行）：
  - `cursorOffsetPx` 为 `null`；
  - 此时**严禁**盲目调用 `scrollIntoView` 强行将视口拽回光标处（这会粗暴打断用户的阅读心流）；
  - 维持视口相对稳定或依据行号几何基准平稳过渡。

### 4. 生命周期与竞态防护契约 (Concurrency & Lifecycle Safety)

- **Generation Token 防护**：每次模式切换自增 `#modeChangeGeneration`。在异步 `requestMeasure` 回调中严格比对 token 与 `this.#destroyed`，快速连击或组件卸载时立即抛弃失效测量；
- **内存防泄漏**：在 `#installDocumentBoundary`（切换/重置文档）以及 `destroy()`（编辑器销毁）中彻底清空模式坐标映射表，避免跨文档复用引起的脏数据污染。

---

## 验证与回归防护

1. **端到端 E2E 自动化测试**：
   - 文件：`apps/desktop/e2e/mode-switch-scroll.spec.ts`
   - **用例 1**：WYSIWYG -> Source 长文档滚动切换，断言光标 100% 位于可见视口中，且屏幕相对 Y 偏移量 $\le 2\text{px}$；
   - **用例 2**：Source -> WYSIWYG 模式切换，断言光标同样稳定停留在视口内；
   - **用例 3**：视口外光标测试（阅读场景），断言切换后视口不发生猛烈回弹跳跃；
   - **用例 4**：UI 按钮点击切换测试，断言通过状态栏/工具栏触发时逻辑行为完全一致。
2. **全量回归保障**：
   - 核心渲染器单元测试：`packages/renderer-codemirror` 全量 438 个单元测试持续 100% 通过；
   - 历史模式切换用例：`codemirror-s1-single-view.spec.ts`、`codemirror-m1-s2-wysiwyg.spec.ts` 零破坏。
