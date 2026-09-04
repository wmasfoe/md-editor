# CodeMirror 选区自绘渲染与跨行边界规范

> 状态：CodeMirror 6 当前生效契约。已验证与单编辑器 WYSIWYG、M5 标题/列表折叠、跨行拖拽选区及动态宽度主题完全兼容。

## 用途

记录 CodeMirror 6 原生自绘选区（`drawSelection()`）的渲染机制、几何坐标计算原理、跨行选区左右溢出防御以及行高/光标对齐契约。修改编辑器基础扩展（`packages/renderer-codemirror/src/renderer.ts`）、编辑器核心容器排版样式（`packages/editor-ui/src/components/CodeMirrorEditor/CodeMirrorEditor.css`）或行首折叠/工具栏逻辑前，必须先读本规范。

---

## 背景与第一性原理 (First Principles)

### 1. 为什么必须使用 CodeMirror 官方 `drawSelection()`
在 CodeMirror 6 中，浏览器的原生 DOM 选区在存在大量自定义块级 Widget、原子行内标记以及负边距容器时，会出现跨行选区垂直断裂、换行间隙不可见、iOS 选区柄异常以及多选区失效等问题。
CodeMirror 官方提供了 `drawSelection()` 扩展，通过独立的 `.cm-selectionLayer` 离屏层自绘 `.cm-selectionBackground` 矩形元素，并在 `.cm-cursorLayer` 绘制光标。

### 2. 跨行选区左右溢出的根因分析
在 `@codemirror/view` 源码的 `rectanglesForRange()` 方法中，跨行选区的中间行矩形（`between`）以及跨行首尾行的水平跨度由以下逻辑计算：

```typescript
let content = view.contentDOM, contentRect = content.getBoundingClientRect(), base = getBase(view);
let lineElt = content.querySelector(".cm-line"), lineStyle = lineElt && window.getComputedStyle(lineElt);
let leftSide = contentRect.left +
    (lineStyle ? parseInt(lineStyle.paddingLeft) + Math.min(0, parseInt(lineStyle.textIndent)) : 0);
let rightSide = contentRect.right - (lineStyle ? parseInt(lineStyle.paddingRight) : 0);
```

- **CM6 的假设前提**：CodeMirror 假定编辑器的水平留白和正文边距写在每行 `.cm-line` 上，而非 `.cm-content` 容器上。
- **本项目的架构现实**：本项目为了支持正文居中、行首折叠按钮 Gutter（5.5rem+）以及块级投影组件（表格、代码块等），将正文内边距统一配置在 `.cm-content` 上：
  ```css
  padding: 3.25rem max(1.25rem, calc((100% - var(--theme-content-width, 860px)) / 2)) 30vh;
  padding-left: max(5.5rem, calc((100% - var(--theme-content-width, 860px)) / 2));
  ```
  而 `.cm-line` 的 `padding-inline` 为 `0`。
- **冲突与溢出**：
  `contentRect.left` 是 `.cm-content` 的外部边界（$x = 0$）。由于 `.cm-line` 的 `paddingLeft` 为 0，CM6 算出的 `leftSide` 为 `0px`，直接铺满左侧 5.5rem 的 Gutter；同理，`rightSide` 直接取了视口全宽，忽略了右侧留白，导致右侧全部溢出。

### 3. 被否决的方案及其教训 (Rejected Alternatives)
1. **否决 `Decoration.mark` 方案**：
   - 尝试通过 CM6 的 Mark Decoration 将选区范围包装为高亮行内 span。
   - 失败原因：在鼠标拖拽选择（drag-selection）过程中，频繁派发的 transaction 会持续打碎和重建 DOM `TextNode`。这破坏了 WebKit 正在追踪的原生拖拽锚点，导致拖选时只有第一个字符高亮，后续拖动字符无法产生高亮选区。
   - **铁律**：选区渲染必须保留在独立覆盖/底层（Layer）中，严禁在选区交互过程中侵入性修改正文文本节点。
2. **否决全量迁移 padding 至 `.cm-line` 方案**：
   - 若将 `.cm-content` 的 padding 转移到 `.cm-line`，则非 `.cm-line` 的块级 Widget（如表格投影 `table-projection`、代码块、数学公式块、分割线等）将失去统一边距约束，破坏全文档对齐。

---

## 必须保持的核心契约 (Core Invariants)

1. **水平裁剪一致性**：
   `.cm-selectionLayer` 必须通过 `clip-path: polygon(...)` 严格约束在正文有效宽度内，计算公式必须与 `.cm-content` 的 `padding-left` 和 `padding-right` 保持 100% 同步：
   ```css
   .code-mirror-editor-host .cm-selectionLayer {
     width: 100%;
     clip-path: polygon(
       max(5.5rem, calc((100% - var(--theme-content-width, 860px)) / 2)) -99999px,
       calc(100% - max(1.25rem, calc((100% - var(--theme-content-width, 860px)) / 2))) -99999px,
       calc(100% - max(1.25rem, calc((100% - var(--theme-content-width, 860px)) / 2))) 999999px,
       max(5.5rem, calc((100% - var(--theme-content-width, 860px)) / 2)) 999999px
     );
   }
   ```
2. **纵向无损滚动**：
   `clip-path` 的纵向坐标必须使用极大延伸区间（`-99999px` 到 `999999px`），绝对禁止限制纵向高度，以确保长文档与虚拟滚动正常工作。
3. **光标层独立性**：
   光标位于独立的 `.cm-cursorLayer`，绝对禁止向 `.cm-cursorLayer` 添加此裁剪规则，保证光标在行首/行末位置精准可见。
4. **行高与选区高度贴合**：
   正文行高统一由 `var(--theme-editor-line-height, 1.62)` 约束，禁止在不同块级元素间随意覆盖 `line-height`，保证自绘选区矩形与文本字符盒紧密贴合无重叠缝隙。
5. **普通段落零 DOM 污染**：
   普通段落行首不得挂载任何产生额外流宽或负边距的 Widget（如旧版 `⋮` 按钮），行首折叠按钮（`FoldToggleWidget`）净流宽为 0，确保标题与各行选区起始位置平齐。

---

## 回归验证清单 (Regression Checklist)

修改编辑器样式或扩展时，必须验证以下场景：
1. **单行部分选择**：字符高亮边界与字符本身左右绝对吻合。
2. **跨多行拖拽选择**：
   - 第一行：从起始字符向右高亮至行末；
   - 中间行：左边界对齐正文起始线，右边界对齐正文结束线，**左侧 5.5rem Gutter 和右侧留白区域无任何蓝色背景溢出**；
   - 最后一行：从正文起始线向右高亮至选区结束字符。
3. **窗口缩放与响应式验证**：拉伸窗口宽度，选区边缘随正文居中公式动态平滑对齐。
4. **长文档滚动**：纵向滚动至数千像素深处，选区背景依然完整可见，不被纵向截断。
5. **自动化测试守卫**：运行 `pnpm test` 及 Playwright e2e 选区测试通过。
