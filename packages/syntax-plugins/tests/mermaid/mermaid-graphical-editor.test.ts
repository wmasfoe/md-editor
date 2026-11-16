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

  it("keeps unsupported syntax on the source editing path", async () => {
    await expect(
      mermaidGraphicalEditor.inspect("flowchart TD\nsubgraph group\n A-->B\nend"),
    ).resolves.toMatchObject({ supported: false, reason: expect.any(String) });
    await expect(
      mermaidGraphicalEditor.inspect("sequenceDiagram\nloop repeat\n A->>B: hi\nend"),
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
    expect(connectButton).toBeDefined();
    connectButton?.click();
    const firstSelect = container.querySelector<HTMLSelectElement>(
      ".cm-md-mermaid-graphical-input select",
    );
    expect(firstSelect).not.toBeNull();
    expect([...firstSelect!.options].map((option) => option.textContent)).toEqual(["one", "two"]);
    firstSelect!.value = "A";
    const secondSelect = container.querySelectorAll<HTMLSelectElement>(
      ".cm-md-mermaid-graphical-input select",
    )[1];
    expect(secondSelect).toBeDefined();
    secondSelect!.value = "B";
    container.querySelector<HTMLButtonElement>(".cm-md-mermaid-graphical-input button")!.click();
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
    expect(reportedError).toContain("请先删除引用此节点的关系");
    expect(changeCount).toBe(1);
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
    expect(changeCount).toBe(1);
    dialog.remove();
    vi.restoreAllMocks();
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
