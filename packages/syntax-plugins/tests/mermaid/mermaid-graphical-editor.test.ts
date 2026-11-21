// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxPluginHostPortsFacet } from "@md-editor/plugin-sdk/syntax";
import { mermaidGraphicalEditor } from "../../src/mermaid/mermaid-graphical-editor.ts";
import { MermaidBlockWidget } from "../../src/mermaid/mermaid-projection.ts";
import {
  parseMermaid,
  renderMermaidSvg,
  runMermaidOperation,
} from "../../src/mermaid/mermaid-loader.ts";

describe("Mermaid graphical editor capability", () => {
  it("enables graphical editing when CodeMirror inspects a detached widget", async () => {
    const openGraphicalCodeBlockEditor = vi.fn();
    const state = EditorState.create({
      extensions: [syntaxPluginHostPortsFacet.of({ openGraphicalCodeBlockEditor })],
    });
    const view = {
      state,
      dom: document.createElement("div"),
      requestMeasure: vi.fn(),
    } as unknown as EditorView;
    const widget = new MermaidBlockWidget("record-1", "flowchart TD\n A --> B", 0);
    const dom = widget.toDOM(view);
    const button = dom.querySelector<HTMLButtonElement>('[aria-label="图形编辑图表"]')!;

    expect(dom.isConnected).toBe(false);
    expect(button.disabled).toBe(true);
    for (let attempt = 0; attempt < 50 && button.disabled; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(button.disabled).toBe(false);
    expect(button.title).toBe("编辑");
    document.body.append(dom);
    button.click();
    expect(openGraphicalCodeBlockEditor).toHaveBeenCalledWith({
      recordId: "record-1",
      provider: mermaidGraphicalEditor,
    });
    dom.remove();
    widget.destroy(dom);
  });

  it("rerenders the SVG when the application theme scheme changes", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    const root = document.documentElement;
    const originalScheme = root.dataset.themeScheme;
    const originalTheme = root.dataset.theme;
    const hadDarkClass = root.classList.contains("dark");
    delete root.dataset.themeScheme;
    delete root.dataset.theme;
    root.classList.remove("dark");
    const state = EditorState.create();
    const view = {
      state,
      dom: document.createElement("div"),
      requestMeasure: vi.fn(),
    } as unknown as EditorView;
    const widget = new MermaidBlockWidget("theme-record", "flowchart TD\n A[Node] --> B[Other]", 0);
    const dom = widget.toDOM(view);
    document.body.append(dom);
    const themeStyles = (): string | null => dom.querySelector("svg style")?.textContent ?? null;

    for (let attempt = 0; attempt < 50 && !themeStyles(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const lightStyle = themeStyles();
    expect(lightStyle).not.toBeNull();

    root.dataset.themeScheme = "dark";
    for (let attempt = 0; attempt < 50 && themeStyles() === lightStyle; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(themeStyles()).not.toBe(lightStyle);

    widget.destroy(dom);
    dom.remove();
    const darkStyle = themeStyles();
    delete root.dataset.themeScheme;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(themeStyles()).toBe(darkStyle);
    if (hadDarkClass) root.classList.add("dark");
    else root.classList.remove("dark");
    if (originalScheme === undefined) {
      delete root.dataset.themeScheme;
    } else {
      root.dataset.themeScheme = originalScheme;
    }
    if (originalTheme === undefined) delete root.dataset.theme;
    else root.dataset.theme = originalTheme;
  });

  it("supports the simple flowchart and sequenceDiagram baseline sources", async () => {
    await expect(mermaidGraphicalEditor.inspect("flowchart TD")).resolves.toEqual({
      supported: true,
    });
    await expect(mermaidGraphicalEditor.inspect("sequenceDiagram")).resolves.toEqual({
      supported: true,
    });
  });

  it("supports sequence fragments, autonumber, notes and activations", async () => {
    // 回归：带 alt/else + autonumber 的真实时序图曾被整类拒绝，工具栏只剩「编辑源码」。
    const source = `sequenceDiagram
    autonumber
    actor User as 用户
    participant CM as CodeMirror 编辑器
    participant Loader as Dynamic Loader
    User->>CM: 打开包含 Mermaid 的文档
    CM->>Loader: loadMermaid()
    alt 首次加载 (未缓存)
        Loader->>Loader: 注册主题与初始化
    else 已加载
        Loader-->>CM: 直接命中单例
    end
    note right of CM: 缓存命中
    activate CM
    CM-->>User: 渲染图表
    deactivate CM`;
    await expect(mermaidGraphicalEditor.inspect(source)).resolves.toEqual({
      supported: true,
    });
  });

  it("keeps unsupported syntax on the source editing path", async () => {
    await expect(
      mermaidGraphicalEditor.inspect("flowchart TD\nsubgraph group\n A-->B\nend"),
    ).resolves.toMatchObject({ supported: false, reason: expect.any(String) });
    // create/destroy 携带参与者生命周期，renameParticipant 不会同步这些行。
    await expect(
      mermaidGraphicalEditor.inspect("sequenceDiagram\n create participant B\n A->>B: hi"),
    ).resolves.toMatchObject({ supported: false, reason: expect.any(String) });
    await expect(
      mermaidGraphicalEditor.inspect("pie\n title Other diagram"),
    ).resolves.toMatchObject({ supported: false, reason: expect.any(String) });
  });

  it("rejects ambiguous identities and malformed Mermaid before graphical writes", async () => {
    await expect(
      mermaidGraphicalEditor.inspect("flowchart TD\n A[one]\n A[two]"),
    ).resolves.toMatchObject({ supported: false, reason: expect.any(String) });
    await expect(
      mermaidGraphicalEditor.inspect(
        "sequenceDiagram\n participant A as Same\n participant B as Same",
      ),
    ).resolves.toMatchObject({ supported: false, reason: expect.any(String) });
    await expect(mermaidGraphicalEditor.inspect("flowchart TD\n A -->")).resolves.toMatchObject({
      supported: false,
      reason: expect.any(String),
    });
  });

  it("mounts the production canvas and emits a validated connection edit", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    // jsdom has no layout, so every rect is zero-sized. The connect handles are
    // positioned from real geometry and correctly refuse to render for a
    // zero-sized node, so give the fixture a deterministic box per entity.
    const elementPrototype = window.Element.prototype as Element & {
      getBoundingClientRect: () => DOMRect;
    };
    const originalRect = elementPrototype.getBoundingClientRect;
    elementPrototype.getBoundingClientRect = function (this: Element) {
      const entity = this.getAttribute?.("data-mw-entity");
      if (entity === "node:A")
        return { x: 0, y: 0, top: 0, left: 0, width: 100, height: 40 } as DOMRect;
      if (entity === "node:B")
        return { x: 200, y: 0, top: 0, left: 200, width: 100, height: 40 } as DOMRect;
      return originalRect.call(this);
    };
    // jsdom also lacks hit testing; resolve the drop target from the same boxes.
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = (x: number, y: number) => {
      for (const id of ["node:A", "node:B"]) {
        const element = container.querySelector(`[data-mw-entity="${id}"]`);
        const box = element?.getBoundingClientRect();
        if (!box) continue;
        if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height)
          return element as Element;
      }
      return null;
    };
    const dialog = document.createElement("dialog");
    dialog.open = true;
    const container = document.createElement("div");
    dialog.append(container);
    document.body.append(dialog);
    const prompt = vi.spyOn(window, "prompt");
    let resolveChange: ((value: string) => void) | null = null;
    let changeCount = 0;
    let reportedError = "";
    const changed = new Promise<string>((resolve) => {
      resolveChange = resolve;
    });
    const handle = await mermaidGraphicalEditor.mount({
      container,
      source: "flowchart TD\n A[one]\n B[two]",
      isDark: false,
      onChange: (source) => {
        changeCount++;
        resolveChange?.(source);
      },
      onError: (error) => {
        reportedError = error.message;
      },
    });
    const connectButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "连接节点",
    );
    // The button offers an alternative to dragging a connection handle.
    expect(connectButton?.disabled).toBe(false);
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "选择起终点",
      ),
    ).toBe(false);
    // Selecting a node reveals one handle per edge midpoint.
    for (
      let attempt = 0;
      attempt < 20 && !container.querySelector('[data-mw-entity="node:A"]');
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    container
      .querySelector<SVGElement>('[data-mw-entity="node:A"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() =>
      expect(container.querySelectorAll(".mw-connect-handle")).toHaveLength(4),
    );
    // Dragging a handle onto another node dispatches the same semantic connect op.
    const rightHandle = container.querySelector<HTMLElement>(
      '.mw-connect-handle[data-side="right"]',
    )!;
    const target = container.querySelector<SVGElement>('[data-mw-entity="node:B"]')!;
    const targetBox = target.getBoundingClientRect();
    rightHandle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 5, clientY: 5 }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: targetBox.left + targetBox.width / 2,
        clientY: targetBox.top + targetBox.height / 2,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: targetBox.left + targetBox.width / 2,
        clientY: targetBox.top + targetBox.height / 2,
      }),
    );
    await expect(changed).resolves.toContain("A --> B");
    expect(prompt).not.toHaveBeenCalled();
    for (
      let attempt = 0;
      attempt < 20 && !container.querySelector('[data-mw-entity="node:A"]');
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const connectedNode = container.querySelector<SVGElement>('[data-mw-entity="node:A"]');
    expect(connectedNode).not.toBeNull();
    connectedNode!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const nativeDelete = container.querySelector<HTMLButtonElement>(
      '.mw-popover button[title="Delete"]',
    );
    expect(nativeDelete).not.toBeNull();
    nativeDelete!.click();
    await vi.waitFor(() => expect(changeCount).toBe(2));
    expect(reportedError).toBe("");
    container.querySelector<HTMLButtonElement>("button")!.click();
    const inputPanel = container.querySelector<HTMLElement>(".cm-md-mermaid-graphical-input");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    inputPanel!.querySelector("input")!.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    container.querySelector<HTMLButtonElement>("button")!.click();
    expect(container.querySelector(".cm-md-mermaid-graphical-input input")).not.toBeNull();
    handle.destroy();
    await Promise.resolve();
    expect(container.querySelector(".cm-md-mermaid-graphical-input")).toBeNull();
    expect(changeCount).toBe(2);
    dialog.remove();
    vi.restoreAllMocks();
    document.elementFromPoint = originalElementFromPoint;
    elementPrototype.getBoundingClientRect = originalRect;
  });

  it("renames a selected flowchart label through the production toolbar", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    const container = document.createElement("div");
    document.body.append(container);
    const updates: string[] = [];
    const handle = await mermaidGraphicalEditor.mount({
      container,
      source: "flowchart TD\n A[Original]\n B[Other]",
      isDark: false,
      onChange: (source) => updates.push(source),
    });
    for (
      let attempt = 0;
      attempt < 50 && !container.querySelector('[data-mw-entity="node:A"]');
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const node = container.querySelector<SVGElement>('[data-mw-entity="node:A"]');
    expect(node).not.toBeNull();
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const toolbar = container.querySelector(".cm-md-mermaid-graphical-toolbar")!;
    const renameButton = [...toolbar.querySelectorAll("button")].find(
      (button) => button.textContent === "修改节点文字",
    );
    renameButton!.click();
    const other = container.querySelector<SVGElement>('[data-mw-entity="node:B"]')!;
    other.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      [
        ...toolbar.querySelectorAll<HTMLButtonElement>(
          ".cm-md-mermaid-graphical-toolbar__actions button",
        ),
      ].every((button) => button.disabled),
    ).toBe(true);
    const input = container.querySelector<HTMLInputElement>(".cm-md-mermaid-graphical-input input");
    expect(input).not.toBeNull();
    input!.value = "Renamed";
    container.querySelector<HTMLButtonElement>(".cm-md-mermaid-graphical-input button")!.click();
    for (let attempt = 0; attempt < 50 && updates.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(updates).toEqual(["flowchart TD\n A[Renamed]\n B[Other]"]);
    handle.destroy();
    container.remove();
  });

  it("edits the selected duplicate sequence message without changing its twin", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    const container = document.createElement("div");
    document.body.append(container);
    const updates: string[] = [];
    const handle = await mermaidGraphicalEditor.mount({
      container,
      source: "sequenceDiagram\n participant A\n participant B\n A->>B: same\n A->>B: same",
      isDark: false,
      onChange: (source) => updates.push(source),
    });
    for (
      let attempt = 0;
      attempt < 50 && container.querySelectorAll('[data-mw-entity="event:4"]').length === 0;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const secondMessage = container.querySelector<SVGElement>('[data-mw-entity="event:4"]');
    expect(secondMessage).not.toBeNull();
    secondMessage!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const toolbar = container.querySelector(".cm-md-mermaid-graphical-toolbar")!;
    const editButton = [...toolbar.querySelectorAll("button")].find(
      (button) => button.textContent === "修改消息文字",
    );
    editButton!.click();
    const input = container.querySelector<HTMLInputElement>(".cm-md-mermaid-graphical-input input");
    expect(input).not.toBeNull();
    input!.value = "second only";
    container.querySelector<HTMLButtonElement>(".cm-md-mermaid-graphical-input button")!.click();
    for (let attempt = 0; attempt < 50 && updates.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(updates).toEqual([
      "sequenceDiagram\n participant A\n participant B\n A->>B: same\n A->>B: second only",
    ]);
    handle.destroy();
    container.remove();
  });

  it("edits a sequence block condition through the production toolbar", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    const container = document.createElement("div");
    document.body.append(container);
    const updates: string[] = [];
    const source = [
      "sequenceDiagram",
      " autonumber",
      " participant A",
      " participant B",
      " A->>B: hi",
      " alt old condition",
      "   B-->>A: yes",
      " else other condition",
      "   B-->>A: no",
      " end",
    ].join("\n");
    const handle = await mermaidGraphicalEditor.mount({
      container,
      source,
      isDark: false,
      onChange: (next) => updates.push(next),
    });
    const toolbar = container.querySelector(".cm-md-mermaid-graphical-toolbar")!;
    const blockButton = [...toolbar.querySelectorAll("button")].find(
      (button) => button.textContent === "修改块条件",
    );
    // Blocks are not canvas entities, so the only entry point is this toolbar action.
    expect(blockButton).not.toBeUndefined();
    expect(blockButton!.hidden).toBe(false);
    blockButton!.click();
    const panel = container.querySelector<HTMLElement>(".cm-md-mermaid-graphical-input")!;
    const select = panel.querySelector("select")!;
    const input = panel.querySelector("input")!;
    expect(select.value).toBe("5");
    expect(input.value).toBe("old condition");
    // Switching the branch refills the condition field with that branch's text.
    select.value = "7";
    select.dispatchEvent(new Event("change"));
    expect(input.value).toBe("other condition");
    select.value = "5";
    select.dispatchEvent(new Event("change"));
    expect(input.value).toBe("old condition");
    input.value = "x > 0 && [重试]";
    panel.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toContain(" alt x > 0 && [重试]");
    expect(updates[0]).toContain(" else other condition");
    expect(updates[0]).toContain(" autonumber");

    // `#` would be silently truncated by Mermaid's restOfLine lexer: reject it in the form
    // and keep the panel open with a reason instead of writing a half-rendered condition.
    blockButton!.click();
    const rejectedPanel = container.querySelector<HTMLElement>(".cm-md-mermaid-graphical-input")!;
    rejectedPanel.querySelector<HTMLInputElement>("input")!.value = "retry #3";
    rejectedPanel.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(
        container.querySelector(".cm-md-mermaid-graphical-toolbar output")?.textContent,
      ).toContain("#"),
    );
    expect(container.querySelector(".cm-md-mermaid-graphical-input")).not.toBeNull();
    expect(updates).toHaveLength(1);
    handle.destroy();
    container.remove();
  });

  it("keeps a pending input busy and ignores Enter during IME composition", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    const container = document.createElement("div");
    document.body.append(container);
    const busyStates: boolean[] = [];
    const changed = vi.fn();
    let busyStatesAtChange: readonly boolean[] | undefined;
    const handle = await mermaidGraphicalEditor.mount({
      container,
      source: "flowchart TD",
      isDark: false,
      onChange: (source) => {
        busyStatesAtChange = [...busyStates];
        changed(source);
      },
      onBusyChange: (busy) => busyStates.push(busy),
    });
    container.querySelector<HTMLButtonElement>("button")!.click();
    const field = container.querySelector<HTMLInputElement>(
      ".cm-md-mermaid-graphical-input input",
    )!;
    expect(busyStates.at(-1)).toBe(true);

    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    const bubbled = vi.fn();
    container.addEventListener("keydown", bubbled);
    field.dispatchEvent(composingEnter);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(bubbled).not.toHaveBeenCalled();
    expect(container.querySelector(".cm-md-mermaid-graphical-input")).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(busyStates.at(-1)).toBe(true);

    field.value = "New node";
    field.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() =>
      expect(changed).toHaveBeenCalledWith(expect.stringContaining("New node")),
    );
    expect(busyStatesAtChange?.every(Boolean)).toBe(true);
    await vi.waitFor(() => expect(busyStates.at(-1)).toBe(false));

    container.querySelector<HTMLButtonElement>("button")!.click();
    expect(busyStates.at(-1)).toBe(true);
    container
      .querySelector<HTMLButtonElement>(".cm-md-mermaid-graphical-input button:last-child")!
      .click();
    await vi.waitFor(() => expect(busyStates.at(-1)).toBe(false));

    container.querySelector<HTMLButtonElement>("button")!.click();
    expect(busyStates.at(-1)).toBe(true);
    handle.destroy();
    expect(busyStates.at(-1)).toBe(false);
    expect(container.querySelector(".cm-md-mermaid-graphical-input")).toBeNull();
    container.remove();
  });

  it("does not mount after its editor session is aborted during serialized inspection", async () => {
    let notifyEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = runMermaidOperation(false, async () => {
      notifyEntered();
      await blocker;
    });
    await entered;

    const container = document.createElement("div");
    const controller = new AbortController();
    const mounting = mermaidGraphicalEditor.mount({
      container,
      source: "flowchart TD",
      isDark: false,
      signal: controller.signal,
      onChange: () => undefined,
    });
    controller.abort();
    release();

    const handle = await mounting;
    await queued;
    expect(container.childNodes).toHaveLength(0);
    expect(container.classList.contains("mw-canvas")).toBe(false);
    handle.destroy();
  });
});

describe("serialized strict Mermaid runtime", () => {
  it("parses and renders concurrently requested light and dark diagrams", async () => {
    const svgPrototype = window.SVGElement.prototype as SVGElement & {
      getBBox?: () => DOMRect;
      getComputedTextLength?: () => number;
    };
    svgPrototype.getBBox ??= () => ({ x: 0, y: 0, width: 80, height: 24 }) as DOMRect;
    svgPrototype.getComputedTextLength ??= () => 64;
    const [light, dark, parsed] = await Promise.all([
      renderMermaidSvg("flowchart TD\n A[Light] --> B[Next]", false),
      renderMermaidSvg("flowchart TD\n A[Dark] --> B[Next]", true),
      parseMermaid("sequenceDiagram\n Alice->>Bob: hello", false),
    ]);
    expect(light.error).toBeUndefined();
    expect(dark.error).toBeUndefined();
    expect(light.svg).toContain("Light");
    expect(dark.svg).toContain("Dark");
    expect(parsed).toBeUndefined();
  });
});
