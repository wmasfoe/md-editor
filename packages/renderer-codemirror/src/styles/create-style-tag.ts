/**
 * @file create-style-tag.ts
 * @description 幂等的 `<style>` 注入器（Tiptap `createStyleTag` 同构）。
 *
 * 为什么需要它：渲染器自持样式后，必须在运行时把 CSS 送进宿主文档。要求：
 * 1. **幂等**：同一 id 只创建一个 `<style>`，重复调用刷新内容而不追加节点
 *    （否则 HMR / 多次挂载会累积重复规则）；
 * 2. **CSP 友好**：支持 `nonce`，让启用 `style-src 'nonce-...'` 的宿主不被拦；
 * 3. **可注入端口**：不直接依赖全局 `document`，便于 Node 侧单测与多文档宿主。
 *
 * 与 `media-viewer/styles.ts` 的 `ensureViewerStyleElement` 保持同一范式，
 * 但抽象成通用函数，供所有 renderer 样式复用。
 */

/** 样式元素的最小接口（Node 侧可用 mini-port 驱动）。 */
export interface StyleElementPort {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

/** 样式注入端口：只声明实现真正使用的成员。 */
export interface StyleInjectionPort {
  getElementById(id: string): StyleElementPort | null;
  createStyleElement(): StyleElementPort;
  /**
   * 把 `<style>` 放进文档。
   * 浏览器端口插在第一个 `style` / `link` 之前，让后出现的作者样式在同特异性下胜出。
   */
  appendToHead(node: StyleElementPort): void;
}

export interface EnsureStyleElementOptions {
  /** `<style>` 元素的 id（幂等键）。 */
  readonly id: string;
  /** 要写入的 CSS 文本。 */
  readonly css: string;
  /** CSP nonce；提供时写入 `nonce` 属性。 */
  readonly nonce?: string | undefined;
  /** 注入端口。 */
  readonly port: StyleInjectionPort;
}

/**
 * 确保指定 id 的 `<style>` 存在且内容为给定 CSS。
 *
 * 已存在时只比较并刷新 `textContent`（`textContent === css` 时完全跳过写入，
 * 避免无谓的样式重算）。
 */
export function ensureStyleElement(options: EnsureStyleElementOptions): void {
  const { id, css, nonce, port } = options;
  const existing = port.getElementById(id);

  if (existing) {
    if (existing.textContent !== css) {
      existing.textContent = css;
    }
    return;
  }

  const element = port.createStyleElement();
  element.setAttribute("id", id);
  if (nonce !== undefined) {
    element.setAttribute("nonce", nonce);
  }
  element.textContent = css;
  port.appendToHead(element);
}

/** 由宿主 `Document` 构造注入端口（浏览器路径）。 */
export function createDocumentStylePort(doc: Document): StyleInjectionPort {
  return {
    getElementById: (id) =>
      typeof doc.getElementById === "function" ? doc.getElementById(id) : null,
    createStyleElement: () => doc.createElement("style"),
    appendToHead: (node) => {
      // 插到已有样式表前面：编辑器往往晚于主题挂载，若 append 到 head 末尾，
      // 同特异性的用户 CSS（含 #md-editor-custom-theme）会被渲染器盖掉。
      mountBeforeAuthorStyles(doc.head, node as unknown as Node);
    },
  };
}

/**
 * 把样式节点插到 head 里第一个 `style` / `link` 之前。
 * 没有作者样式表时退回 append。`children` 或 `insertBefore` 缺失（单测 mock）时同样 append。
 */
function mountBeforeAuthorStyles(head: HTMLElement, node: Node): void {
  const children = head.children;
  if (children && typeof head.insertBefore === "function") {
    for (const child of Array.from(children)) {
      const tag = child.tagName?.toUpperCase();
      if (tag === "STYLE" || tag === "LINK") {
        head.insertBefore(node, child);
        return;
      }
    }
  }
  head.append(node);
}

/**
 * 当前 `Document` 是否具备注入样式所需的最小能力。
 *
 * 单测里的 `document` 常是只实现了部分 API 的 mock；样式注入是**尽力而为**的辅助行为，
 * 绝不该因为宿主文档不完整而让渲染器创建失败。
 */
export function canInjectInto(doc: Document): boolean {
  return (
    typeof doc.createElement === "function" &&
    doc.head !== null &&
    doc.head !== undefined &&
    typeof (doc.head as unknown as { append?: unknown }).append === "function"
  );
}
