/**
 * node 侧驱动 `media-viewer/browser.ts` 的**最小 fake DOM**（仅实现适配层真正调用的成员）。
 *
 * 为什么需要它：`browser.ts` 是本次唯一没有 node 测试的文件（评审 r3 L-3/L-9、r4 指出）。
 * 完整复刻 DOM 不现实，但适配层只用到很少一部分 API；把这些显式列出来，
 * 配 `browser.test.ts` 就能覆盖「组装 / inert / 监听成对 / 句柄登记」这些真会出错的部分。
 *
 * 能力边界（诚实）：本 fake **不解析 HTML**，因此只驱动**图片路径**（`createElement("img")`）；
 * SVG 路径的 `stage.innerHTML = svg` + `querySelector("svg")` 仍由 e2e 覆盖。
 */

type Listener = (event: unknown) => void;

interface ListenerRecord {
  readonly type: string;
  readonly listener: Listener;
  readonly capture: boolean;
}

export class FakeClassList {
  readonly tokens = new Set<string>();
  constructor(private readonly owner: FakeElement) {}
  add(...names: string[]): void {
    for (const name of names) {
      this.tokens.add(name);
    }
  }
  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.tokens.has(name);
    if (next) {
      this.tokens.add(name);
    } else {
      this.tokens.delete(name);
    }
    return next;
  }
  contains(name: string): boolean {
    return this.tokens.has(name);
  }
}

export class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners: ListenerRecord[] = [];
  readonly classList = new FakeClassList(this);
  readonly style: Record<string, string> & { transform?: string } = {};
  parent: FakeElement | null = null;
  /** 所属 document（用于让 `setAttribute("id", …)` 能被 `getElementById` 查到）。 */
  owner: FakeDocument | null = null;
  private classNamesState = "";
  get className(): string {
    return this.classNamesState;
  }
  /** 与真实 DOM 一致：`className` 赋值会同步 `classList`。 */
  set className(next: string) {
    this.classNamesState = next;
    this.classList.tokens.clear();
    for (const token of next.split(/\s+/u)) {
      if (token !== "") {
        this.classList.tokens.add(token);
      }
    }
  }

  textContent: string | null = null;
  innerHTML = "";
  tabIndex = 0;
  title = "";
  type = "";
  disabled = false;
  draggable = false;
  src = "";
  alt = "";
  focusCalls = 0;
  captureCalls = 0;
  releasedCaptureCalls = 0;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") {
      this.owner?.indexId(value, this);
    }
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove(): void {
    const parent = this.parent;
    if (!parent) {
      return;
    }
    const index = parent.children.indexOf(this);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
    this.parent = null;
  }

  contains(node: FakeElement | null): boolean {
    if (!node) {
      return false;
    }
    if (node === this) {
      return true;
    }
    return this.children.some((child) => child.contains(node));
  }

  /** 仅支持 `.class` 与 `tag` 两种简单选择器（足够本适配层使用）。 */
  querySelector(selector: string): FakeElement | null {
    return this.find((node) => {
      if (selector.startsWith(".")) {
        return node.classList.contains(selector.slice(1));
      }
      return node.tagName === selector;
    });
  }

  find(predicate: (node: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) {
        return child;
      }
      const nested = child.find(predicate);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  addEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    this.listeners.push({ type, listener, capture });
  }

  removeEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    const index = this.listeners.findIndex(
      (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  /** 触发已注册的监听（默认冒泡相与捕获相都触发，顺序按注册序）。 */
  fire(type: string, event: unknown): void {
    for (const entry of this.listeners) {
      if (entry.type === type) {
        entry.listener(event);
      }
    }
  }

  focus(): void {
    this.focusCalls += 1;
  }

  setPointerCapture(): void {
    this.captureCalls += 1;
  }

  releasePointerCapture(): void {
    this.releasedCaptureCalls += 1;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    // 视口固定为 1000×500；真实尺寸只影响几何计算，不影响本文件要覆盖的生命周期行为
    return { left: 0, top: 0, width: 1000, height: 500 };
  }
}

export class FakeDocument {
  readonly body = new FakeElement("body");
  readonly head = new FakeElement("head");
  readonly documentElement = new FakeElement("html");
  readonly listeners: ListenerRecord[] = [];
  private readonly byId = new Map<string, FakeElement>();

  constructor() {
    this.head.parent = null;
  }

  createElement(tagName: string): FakeElement {
    const element = new FakeElement(tagName);
    element.owner = this;
    return element;
  }

  /** 登记 id 索引（仅 fake 内部使用：模拟真实 DOM 的 `getElementById` 可见性）。 */
  indexId(id: string, element: FakeElement): void {
    this.byId.set(id, element);
  }

  getElementById(id: string): FakeElement | null {
    if (!this.byId.has(id)) {
      return null;
    }
    return this.byId.get(id) ?? null;
  }

  /** 测试辅助：登记一个带 id 的元素（例如 `#root`）。 */
  register(id: string, element: FakeElement): FakeElement {
    element.owner = this;
    this.byId.set(id, element);
    element.setAttribute("id", id);
    if (!element.parent) {
      element.parent = this.body;
      this.body.children.push(element);
    }
    return element;
  }

  addEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    this.listeners.push({ type, listener, capture });
  }

  removeEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { capture?: boolean },
  ): void {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false);
    const index = this.listeners.findIndex(
      (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  fire(type: string, event: unknown): void {
    for (const entry of this.listeners) {
      if (entry.type === type) {
        entry.listener(event);
      }
    }
  }
}

/** 构造一对可共用的 fake document 与 `#root`。 */
export function createFakeDocumentWithRoot(): { doc: FakeDocument; root: FakeElement } {
  const doc = new FakeDocument();
  const root = doc.register("root", new FakeElement("div"));
  return { doc, root };
}
