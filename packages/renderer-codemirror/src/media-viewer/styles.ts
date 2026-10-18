/**
 * @file styles.ts
 * @description 媒体查看器的**自持样式**：无任何祖先前缀的常量 + 幂等的 `<style>` 注入。
 *
 * 为什么样式放在 TS 常量里、运行期注入 `document.head`（非典型，故此处写明原因）：
 * 1. 浮层挂在 `document.body` 上，而宿主样式表的规则统一带 `.code-mirror-editor-host` 前缀
 *    （只挂在 React 宿主 div 上）⇒ 浮层规则永不匹配（这是本仓库真实的既有缺陷）；
 * 2. `EditorView.baseTheme` 也不行：它会把不含 `&` 的选择器编译成 `.<baseThemeID> <sel>`，
 *    即要求目标元素是 `.cm-editor` 的**后代**，同样命不中 body 级浮层；
 * 3. 因此只剩"无前缀 + 运行期注入"一条路：既能命中 body 级节点，又不依赖宿主样式表是否加载
 *    （多宿主共享：desktop / web / utools，将来移动端亦可复用），且保持零新增依赖。
 *
 * 注入范式对齐 `packages/editor-ui/src/themes/built-in-themes.ts`（`getElementById` → `head.append`
 * → `textContent` 比对），并按 `textContent === css` 比对刷新，避免 HMR 后残留旧规则。
 */

/** 注入元素的 id（幂等键）。 */
export const VIEWER_STYLE_ELEMENT_ID = "md-media-viewer-style";

/** 样式元素的最小接口（node 侧用 mini-port 驱动）。 */
export interface ViewerStyleElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

/** 样式注入端口：只声明实现真正使用的成员。 */
export interface ViewerStylePort {
  getElementById(id: string): ViewerStyleElement | null;
  createStyleElement(): ViewerStyleElement;
  appendToHead(node: ViewerStyleElement): void;
}

/**
 * 浮层样式（**无任何祖先前缀**）。
 * 颜色/圆角沿用既有 `--theme-*` 自定义属性（定义在 `:root`，body 级节点可继承），并给出回退值。
 */
export const VIEWER_CSS = [
  ".cm-md-media-viewer {",
  "  position: fixed;",
  "  inset: 0;",
  "  z-index: 1000;",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  background: rgba(0, 0, 0, 0.72);",
  "  cursor: zoom-out;",
  "}",
  ".cm-md-media-viewer__stage {",
  "  position: relative;",
  "  display: flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  max-width: 92vw;",
  "  max-height: 92vh;",
  "}",
  ".cm-md-media-viewer--zoom-pan .cm-md-media-viewer__stage {",
  "  cursor: grab;",
  "}",
  ".cm-md-media-viewer--dragging .cm-md-media-viewer__stage {",
  "  cursor: grabbing;",
  "}",
  ".cm-md-media-viewer__media {",
  "  display: block;",
  "  transform-origin: 0 0;",
  "}",
  // 缩放平移模式：内容盒必须从浮层原点 (0,0) 开始，scale/translate 数学里的 (x,y)
  // 才真正等价于“内容盒左上角落在视口 (x,y)”。图片路径（zoomPan:false）不走这条，
  // 仍由 __stage 的 flex 居中 + max-width/max-height 控制尺寸。
  ".cm-md-media-viewer--zoom-pan .cm-md-media-viewer__media {",
  "  position: absolute;",
  "  top: 0;",
  "  left: 0;",
  "}",
  ".cm-md-media-viewer__media--image {",
  "  max-width: 92vw;",
  "  max-height: 92vh;",
  "  object-fit: contain;",
  "  border-radius: 4px;",
  "  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5);",
  "  cursor: default;",
  "}",
  ".cm-md-media-viewer__media--svg {",
  "  cursor: inherit;",
  "}",
  ".cm-md-media-viewer__close,",
  ".cm-md-media-viewer__edit {",
  "  position: absolute;",
  "  top: 0.75rem;",
  "  border: 1px solid var(--theme-border, rgba(255, 255, 255, 0.25));",
  "  border-radius: 6px;",
  "  background: rgba(0, 0, 0, 0.55);",
  "  color: #fff;",
  "  cursor: pointer;",
  "  font-size: 0.8rem;",
  "  line-height: 1;",
  "  padding: 0.35rem 0.6rem;",
  "}",
  ".cm-md-media-viewer__close {",
  "  right: 0.75rem;",
  "}",
  ".cm-md-media-viewer__edit {",
  "  right: 4.5rem;",
  "}",
  ".cm-md-media-viewer__close:hover,",
  ".cm-md-media-viewer__edit:hover {",
  "  background: rgba(0, 0, 0, 0.75);",
  "}",
].join("\n");

/**
 * 幂等注入浮层样式：已存在则按需刷新文本，不存在则创建并追加到 `head`。
 * 无 `document` 的调用方应由上层跳过（见 `index.ts` 的 `typeof document === "undefined"` 守卫）。
 */
export function ensureViewerStyleElement(port: ViewerStylePort): void {
  const existing = port.getElementById(VIEWER_STYLE_ELEMENT_ID);
  if (existing) {
    if (existing.textContent !== VIEWER_CSS) {
      existing.textContent = VIEWER_CSS;
    }
    return;
  }
  const element = port.createStyleElement();
  element.setAttribute("id", VIEWER_STYLE_ELEMENT_ID);
  element.textContent = VIEWER_CSS;
  port.appendToHead(element);
}
